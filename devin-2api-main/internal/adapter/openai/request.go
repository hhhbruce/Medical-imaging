// 本文件负责把中间请求上下文转换为 OpenAI Chat Completions 请求。
package openai

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/leookun/devin-2api/internal/llm"
)

// buildRequest 将中间请求上下文转换为 OpenAI Chat Completions 请求体。
// 始终以 stream: true 调用上游，并请求 include_usage，以便统一产出中间事件流与用量。
func buildRequest(request llm.RequestMessages, model string) (map[string]any, error) {
	messages := make([]map[string]any, 0, len(request.Messages)+1)
	if strings.TrimSpace(request.SystemPrompt) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": request.SystemPrompt})
	}
	for _, message := range request.Messages {
		converted, err := convertMessage(message)
		if err != nil {
			return nil, err
		}
		messages = append(messages, converted...)
	}

	payload := map[string]any{
		"model":          model,
		"messages":       messages,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
	}
	if len(request.Tools) > 0 {
		tools := make([]map[string]any, 0, len(request.Tools))
		for _, tool := range request.Tools {
			tools = append(tools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        tool.Name,
					"description": tool.Description,
					"parameters":  json.RawMessage(tool.InputSchema),
				},
			})
		}
		payload["tools"] = tools
	}
	return payload, nil
}

// convertMessage 将中间消息转换为零个或多个 OpenAI Chat Completions 消息条目。
func convertMessage(message llm.Message) ([]map[string]any, error) {
	switch m := message.(type) {
	case llm.UserMessage:
		return []map[string]any{{"role": "user", "content": contentToOpenAI(m.Content)}}, nil
	case llm.AssistantMessage:
		msg := map[string]any{
			"role":    "assistant",
			"content": contentText(m.Content),
		}
		var toolCalls []map[string]any
		for _, block := range m.Content {
			if call, ok := block.(llm.ToolCall); ok {
				toolCalls = append(toolCalls, map[string]any{
					"id":   call.ID,
					"type": "function",
					"function": map[string]any{
						"name":      call.Name,
						"arguments": string(call.Arguments),
					},
				})
			}
		}
		if len(toolCalls) > 0 {
			// OpenAI 约定：存在 tool_calls 时 content 应为 null。
			msg["content"] = nil
			msg["tool_calls"] = toolCalls
		}
		return []map[string]any{msg}, nil
	case llm.ToolResultMessage:
		return []map[string]any{{
			"role":         "tool",
			"tool_call_id": m.ToolCallID,
			"content":      contentText(m.Content),
		}}, nil
	default:
		return nil, fmt.Errorf("unsupported message type %T", message)
	}
}

// contentToOpenAI 将中间内容块转换为 OpenAI Chat 内容值。
// 纯文本返回字符串；含图片时返回 parts 数组。
func contentToOpenAI(content []llm.Content) any {
	var parts []map[string]any
	hasImage := false
	for _, block := range content {
		switch c := block.(type) {
		case llm.TextContent:
			parts = append(parts, map[string]any{"type": "text", "text": c.Text})
		case llm.ImageContent:
			hasImage = true
			parts = append(parts, map[string]any{
				"type": "image_url",
				"image_url": map[string]any{
					"url": "data:" + c.MIMEType + ";base64," + c.Data,
				},
			})
		}
	}
	if !hasImage {
		return contentText(content)
	}
	if len(parts) == 0 {
		return ""
	}
	return parts
}

// contentText 从内容块中提取纯文本。
func contentText(content []llm.Content) string {
	var builder strings.Builder
	for _, block := range content {
		if text, ok := block.(llm.TextContent); ok {
			builder.WriteString(text.Text)
		}
	}
	return builder.String()
}
