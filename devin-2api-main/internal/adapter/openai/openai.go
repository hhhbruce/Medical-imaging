// 本文件实现一个面向任意 OpenAI 兼容 /chat/completions 上游的适配器。
//
// Package openai 把供应商无关的 llm.RequestMessages 转换为 OpenAI Chat Completions 调用，
// 并把上游返回的 SSE 流解释为中间响应事件。它让 devin-2api 除了 Devin 之外，
// 还能作为任意 OpenAI 兼容服务（例如 tokenrhythm.studio 这类聚合网关）的统一转接头。
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/leookun/devin-2api/internal/adapter"
	"github.com/leookun/devin-2api/internal/debuglog"
	"github.com/leookun/devin-2api/internal/httpproxy"
	"github.com/leookun/devin-2api/internal/llm"
)

// Config 保存 OpenAI 兼容上游的固定配置。
type Config struct {
	// BaseURL 是上游基础地址，例如 https://tokenrhythm.studio/v1。
	BaseURL string
	// APIKey 是上游访问密钥；通过 Authorization: Bearer 发送。
	APIKey string
	// Model 是默认模型标识；请求未指定模型时使用。
	Model string
}

// Adapter 调用任意 OpenAI 兼容上游的 /chat/completions 与 /models。
type Adapter struct {
	config         Config
	baseURL        string
	client         *http.Client
	modelsMu       sync.RWMutex
	models         []adapter.ModelInfo
	modelsExpiry   time.Time
	modelsCacheTTL time.Duration
}

var _ adapter.Adapter = (*Adapter)(nil)

// New 创建 OpenAI 兼容上游适配器。
func New(config Config) (*Adapter, error) {
	if strings.TrimSpace(config.BaseURL) == "" {
		return nil, errors.New("openai base URL is required")
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("openai api key is required")
	}
	transport, err := httpproxy.NewTransport("", false)
	if err != nil {
		return nil, fmt.Errorf("create openai transport: %w", err)
	}
	// SSE 流需要长期保持连接，不设置 Client.Timeout；
	// 首包等待由 Transport 的 ResponseHeaderTimeout 限制。
	return &Adapter{
		config:         config,
		baseURL:        strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		client:         &http.Client{Transport: transport},
		modelsCacheTTL: 5 * time.Minute,
	}, nil
}

// Stream 将一份中间请求转换为上游 OpenAI Chat Completions 流，并返回中间响应事件流。
func (adapter *Adapter) Stream(ctx context.Context, request llm.RequestMessages) (llm.ResponseStream, error) {
	if err := request.Validate(); err != nil {
		return nil, fmt.Errorf("validate openai request: %w", err)
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = adapter.config.Model
	}
	if model == "" {
		return nil, errors.New("model is required (set request model or openai.model in config)")
	}
	payload, err := buildRequest(request, model)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal openai request: %w", err)
	}

	recorder := debuglog.FromContext(ctx)
	if recorder != nil {
		recorder.WriteJSON("03-openai-request.json", payload)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, adapter.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build openai request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+adapter.config.APIKey)

	resp, err := adapter.client.Do(httpReq)
	if err != nil {
		if recorder != nil {
			recorder.WriteError("openai_request", err)
		}
		return nil, fmt.Errorf("openai upstream request: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		message := extractErrorMessage(raw)
		if message == "" {
			message = fmt.Sprintf("upstream returned HTTP %d", resp.StatusCode)
		}
		if recorder != nil {
			recorder.WriteError("openai_http_status", errors.New(message))
		}
		return nil, errors.New(message)
	}

	return &responseStream{
		body:     resp.Body,
		decoder:  newResponseDecoder(model),
		recorder: recorder,
	}, nil
}

// ListModels 通过 GET /models 拉取上游可用模型目录，结果带 TTL 缓存。
func (adapter *Adapter) ListModels(ctx context.Context) ([]adapter.ModelInfo, error) {
	adapter.modelsMu.RLock()
	if adapter.models != nil && time.Now().Before(adapter.modelsExpiry) {
		cached := adapter.models
		adapter.modelsMu.RUnlock()
		return cached, nil
	}
	adapter.modelsMu.RUnlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, adapter.baseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build openai models request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+adapter.config.APIKey)
	resp, err := adapter.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai upstream models request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		message := extractErrorMessage(raw)
		if message == "" {
			message = fmt.Sprintf("upstream models returned HTTP %d", resp.StatusCode)
		}
		return nil, errors.New(message)
	}

	var list struct {
		Data []struct {
			ID       string `json:"id"`
			Created  int64  `json:"created"`
			OwnedBy  string `json:"owned_by"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("decode openai models response: %w", err)
	}
	now := time.Now().Unix()
	models := make([]adapter.ModelInfo, 0, len(list.Data))
	seen := make(map[string]struct{}, len(list.Data))
	for _, entry := range list.Data {
		if strings.TrimSpace(entry.ID) == "" {
			continue
		}
		if _, ok := seen[entry.ID]; ok {
			continue
		}
		seen[entry.ID] = struct{}{}
		ownedBy := entry.OwnedBy
		if ownedBy == "" {
			ownedBy = "openai"
		}
		models = append(models, adapter.ModelInfo{
			ID: entry.ID, Created: entry.Created, OwnedBy: ownedBy,
			// OpenAI /models 不返回图片能力，默认按支持处理更友好。
			SupportsImages: true,
		})
	}
	// 用户显式配置的 model 即使不在上游列表中，也应可被发现和调用。
	if configured := strings.TrimSpace(adapter.config.Model); configured != "" {
		if _, ok := seen[configured]; !ok {
			models = append(models, adapter.ModelInfo{
				ID: configured, Created: now, OwnedBy: "openai", SupportsImages: true,
			})
		}
	}

	adapter.modelsMu.Lock()
	defer adapter.modelsMu.Unlock()
	if adapter.models != nil && time.Now().Before(adapter.modelsExpiry) {
		return adapter.models, nil
	}
	adapter.models = models
	adapter.modelsExpiry = time.Now().Add(adapter.modelsCacheTTL)
	return models, nil
}

// extractErrorMessage 从 OpenAI 风格错误响应中提取 message。
func extractErrorMessage(raw []byte) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	var envelope struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		// 非 JSON 时截断展示，便于排查。
		text := string(raw)
		if len(text) > 300 {
			text = text[:300] + "..."
		}
		return text
	}
	if envelope.Error.Message != "" {
		return envelope.Error.Message
	}
	return envelope.Message
}
