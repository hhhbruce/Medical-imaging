// 本文件负责把 OpenAI Chat Completions 的 SSE chunk 解释为有序的中间响应事件。
package openai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/leookun/devin-2api/internal/debuglog"
	"github.com/leookun/devin-2api/internal/llm"
)

// chatChunk 是 OpenAI Chat Completions 流式返回的单个增量块。
type chatChunk struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int       `json:"index"`
		Delta        chatDelta `json:"delta"`
		FinishReason *string   `json:"finish_reason"`
	} `json:"choices"`
	Usage *chatUsage `json:"usage"`
}

// chatDelta 是单个增量块中的增量字段。
type chatDelta struct {
	Role             string          `json:"role"`
	Content          string          `json:"content"`
	ReasoningContent string          `json:"reasoning_content"`
	Reasoning        string          `json:"reasoning"`
	ToolCalls        []chatToolDelta `json:"tool_calls"`
}

// chatToolDelta 是增量块中的工具调用片段。
type chatToolDelta struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// chatUsage 是流末尾（include_usage 时）返回的用量。
type chatUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	PromptDetails    struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

// responseDecoder 保存一次 OpenAI 请求内的响应累计状态和内容映射。
type responseDecoder struct {
	model string
	// partial 是当前累计形成的助手消息。
	partial llm.AssistantMessage
	// text / textBuilder 累计文字块，避免 O(n²) 拼接。
	text        *llm.TextContent
	textBuilder strings.Builder
	textIdx     int
	textOpen    bool
	// thinking / thinkingBuilder 累计思考块。
	thinking        *llm.ThinkingContent
	thinkingBuilder strings.Builder
	thinkIdx        int
	thinkingOpen    bool
	// tools 保存正在累计参数的工具调用。
	tools []*toolState
	// started / finished 分别表示已生成 start / 已生成最终事件。
	started  bool
	finished bool
	// hasStopReason / stopReason 保存上游显式返回的停止原因。
	hasStopReason bool
	stopReason    llm.StopReason
}

// toolState 保存一次 OpenAI 工具调用的累计状态。
type toolState struct {
	// index 是 OpenAI 流式工具增量的下标，用于串联同一工具的多段增量。
	index int
	// contentIdx 是工具调用块在 partial.Content 中的位置。
	contentIdx int
	call       llm.ToolCall
	// arguments 累计完整参数 JSON 文本。
	arguments strings.Builder
	// emittedArgs 记录已经作为增量事件发出去的参数字节数。
	emittedArgs int
	emitted     bool
}

func newResponseDecoder(model string) *responseDecoder {
	return &responseDecoder{model: model}
}

func (decoder *responseDecoder) start() []llm.ResponseEvent {
	if decoder.started || decoder.finished {
		return nil
	}
	decoder.started = true
	decoder.partial = llm.AssistantMessage{
		API: "chat_completions", Provider: "openai", Model: decoder.model,
		StopReason: llm.StopReasonPending, TimestampMS: time.Now().UnixMilli(),
	}
	return []llm.ResponseEvent{{Type: llm.ResponseEventStart, Partial: &decoder.partial}}
}

func (decoder *responseDecoder) decode(chunk *chatChunk) []llm.ResponseEvent {
	if chunk == nil || decoder.finished {
		return nil
	}
	decoder.updateMetadata(chunk)
	if len(chunk.Choices) == 0 {
		// 仅有 usage 的末尾块（无 choices），不影响事件。
		return nil
	}
	delta := chunk.Choices[0].Delta
	events := make([]llm.ResponseEvent, 0, 6)

	if reasoning := reasoningContent(delta); reasoning != "" {
		events = append(events, decoder.endText()...)
		events = append(events, decoder.decodeThinking(reasoning)...)
	}
	if delta.Content != "" {
		events = append(events, decoder.endThinking()...)
		events = append(events, decoder.decodeText(delta.Content)...)
	}
	for _, toolDelta := range delta.ToolCalls {
		events = append(events, decoder.endThinking()...)
		events = append(events, decoder.endText()...)
		events = append(events, decoder.decodeTool(toolDelta)...)
	}
	if chunk.Choices[0].FinishReason != nil {
		decoder.hasStopReason = true
		decoder.stopReason = mapFinishReason(*chunk.Choices[0].FinishReason)
	}
	return events
}

func (decoder *responseDecoder) updateMetadata(chunk *chatChunk) {
	if chunk.ID != "" {
		decoder.partial.ResponseID = chunk.ID
	}
	if chunk.Model != "" {
		decoder.partial.ResponseModel = chunk.Model
	}
	if usage := chunk.Usage; usage != nil {
		cached := usage.PromptDetails.CachedTokens
		input := usage.PromptTokens - cached
		if input < 0 {
			input = 0
		}
		decoder.partial.Usage.Input = int64(input)
		decoder.partial.Usage.CacheRead = int64(cached)
		decoder.partial.Usage.Output = int64(usage.CompletionTokens)
		decoder.partial.Usage.TotalTokens = int64(usage.TotalTokens)
		reasoning := int64(usage.CompletionDetails.ReasoningTokens)
		decoder.partial.Usage.Reasoning = &reasoning
	}
}

func (decoder *responseDecoder) decodeThinking(delta string) []llm.ResponseEvent {
	events := make([]llm.ResponseEvent, 0, 2)
	if !decoder.thinkingOpen {
		decoder.thinking = &llm.ThinkingContent{}
		decoder.thinkingBuilder.Reset()
		decoder.partial.Content = append(decoder.partial.Content, *decoder.thinking)
		decoder.thinkIdx = len(decoder.partial.Content) - 1
		decoder.thinkingOpen = true
		events = append(events, llm.ResponseEvent{Type: llm.ResponseEventThinkingStart, ContentIndex: decoder.thinkIdx, Partial: &decoder.partial})
	}
	decoder.thinkingBuilder.WriteString(delta)
	events = append(events, llm.ResponseEvent{Type: llm.ResponseEventThinkingDelta, ContentIndex: decoder.thinkIdx, Delta: delta, Partial: &decoder.partial})
	return events
}

func (decoder *responseDecoder) decodeText(delta string) []llm.ResponseEvent {
	events := make([]llm.ResponseEvent, 0, 2)
	if !decoder.textOpen {
		decoder.text = &llm.TextContent{}
		decoder.textBuilder.Reset()
		decoder.partial.Content = append(decoder.partial.Content, *decoder.text)
		decoder.textIdx = len(decoder.partial.Content) - 1
		decoder.textOpen = true
		events = append(events, llm.ResponseEvent{Type: llm.ResponseEventTextStart, ContentIndex: decoder.textIdx, Partial: &decoder.partial})
	}
	decoder.textBuilder.WriteString(delta)
	events = append(events, llm.ResponseEvent{Type: llm.ResponseEventTextDelta, ContentIndex: decoder.textIdx, Delta: delta, Partial: &decoder.partial})
	return events
}

func (decoder *responseDecoder) decodeTool(delta chatToolDelta) []llm.ResponseEvent {
	state := decoder.findTool(delta.Index)
	if state == nil {
		state = &toolState{
			index:      delta.Index,
			call:       llm.ToolCall{ID: delta.ID, Name: delta.Function.Name, Arguments: json.RawMessage(`{}`)},
			contentIdx: -1,
		}
		decoder.tools = append(decoder.tools, state)
	}
	if delta.ID != "" {
		state.call.ID = delta.ID
	}
	if delta.Function.Name != "" {
		state.call.Name = delta.Function.Name
	}
	if delta.Function.Arguments != "" {
		state.arguments.WriteString(delta.Function.Arguments)
	}

	events := make([]llm.ResponseEvent, 0, 2)
	if !state.emitted {
		// 等待 id 与 name 齐全后再开块，避免产生校验失败的 start 事件。
		if state.call.ID == "" || state.call.Name == "" {
			return nil
		}
		state.contentIdx = len(decoder.partial.Content)
		state.emitted = true
		decoder.partial.Content = append(decoder.partial.Content, state.call)
		events = append(events, llm.ResponseEvent{
			Type: llm.ResponseEventToolCallStart, ContentIndex: state.contentIdx,
			ToolCallID: state.call.ID, ToolName: state.call.Name, Partial: &decoder.partial,
		})
	}
	// 把尚未发出的参数片段作为增量事件补发。
	pending := state.arguments.String()[state.emittedArgs:]
	if pending != "" {
		state.emittedArgs = len(state.arguments.String())
		events = append(events, llm.ResponseEvent{
			Type: llm.ResponseEventToolCallDelta, ContentIndex: state.contentIdx,
			ToolCallID: state.call.ID, Delta: pending, Partial: &decoder.partial,
		})
	}
	return events
}

func (decoder *responseDecoder) finish(upstreamErr error) []llm.ResponseEvent {
	if decoder.finished {
		return nil
	}
	if upstreamErr != nil {
		return decoder.fail(upstreamErr)
	}
	reason := decoder.stopReason
	if !decoder.hasStopReason {
		reason = llm.StopReasonStop
	}
	if reason == llm.StopReasonError {
		return decoder.fail(errors.New("openai upstream returned finish_reason content_filter"))
	}
	return decoder.complete(reason)
}

func (decoder *responseDecoder) endThinking() []llm.ResponseEvent {
	if !decoder.thinkingOpen || decoder.thinking == nil {
		return nil
	}
	decoder.thinkingOpen = false
	decoder.thinking.Thinking = decoder.thinkingBuilder.String()
	decoder.partial.Content[decoder.thinkIdx] = *decoder.thinking
	return []llm.ResponseEvent{{
		Type: llm.ResponseEventThinkingEnd, ContentIndex: decoder.thinkIdx,
		Content: decoder.thinking.Thinking, Partial: &decoder.partial,
	}}
}

func (decoder *responseDecoder) endText() []llm.ResponseEvent {
	if !decoder.textOpen || decoder.text == nil {
		return nil
	}
	decoder.textOpen = false
	decoder.text.Text = decoder.textBuilder.String()
	decoder.partial.Content[decoder.textIdx] = *decoder.text
	return []llm.ResponseEvent{{
		Type: llm.ResponseEventTextEnd, ContentIndex: decoder.textIdx,
		Content: decoder.text.Text, Partial: &decoder.partial,
	}}
}

func (decoder *responseDecoder) findTool(index int) *toolState {
	for _, state := range decoder.tools {
		if state.index == index {
			return state
		}
	}
	return nil
}

func (decoder *responseDecoder) complete(reason llm.StopReason) []llm.ResponseEvent {
	if decoder.finished {
		return nil
	}
	events := make([]llm.ResponseEvent, 0, len(decoder.tools)*3+3)
	decoder.partial.StopReason = reason
	events = append(events, decoder.endThinking()...)
	events = append(events, decoder.endText()...)
	for _, state := range decoder.tools {
		if !state.emitted {
			continue
		}
		state.call.Arguments = json.RawMessage(state.arguments.String())
		if !isJSONObject(state.call.Arguments) {
			state.call.Arguments = json.RawMessage(`{}`)
		}
		decoder.partial.Content[state.contentIdx] = state.call
		events = append(events, llm.ResponseEvent{Type: llm.ResponseEventToolCallEnd, ContentIndex: state.contentIdx, ToolCall: &state.call, Partial: &decoder.partial})
	}
	events = append(events, llm.ResponseEvent{Type: llm.ResponseEventDone, Reason: reason, Message: &decoder.partial})
	decoder.finished = true
	return events
}

func (decoder *responseDecoder) fail(err error) []llm.ResponseEvent {
	if decoder.finished {
		return nil
	}
	decoder.partial.StopReason = llm.StopReasonError
	decoder.partial.ErrorMessage = err.Error()
	decoder.finished = true
	return []llm.ResponseEvent{{Type: llm.ResponseEventError, Reason: llm.StopReasonError, Error: &decoder.partial}}
}

// responseStream 从上游 HTTP 响应体按需读取 SSE 数据行并返回 decoder 生成的事件。
type responseStream struct {
	body     io.ReadCloser
	reader   *bufio.Reader
	decoder  *responseDecoder
	recorder *debuglog.Recorder
	started  bool
	finished bool
	queue    []llm.ResponseEvent
}

func (stream *responseStream) Recv(ctx context.Context) (llm.ResponseEvent, error) {
	for len(stream.queue) == 0 && !stream.finished {
		if err := ctx.Err(); err != nil {
			stream.body.Close()
			return llm.ResponseEvent{}, err
		}
		if stream.reader == nil {
			stream.reader = bufio.NewReader(stream.body)
		}
		if !stream.started {
			stream.started = true
			stream.queue = append(stream.queue, stream.decoder.start()...)
			break
		}
		data, err := readSSEData(stream.reader)
		if errors.Is(err, io.EOF) {
			stream.queue = append(stream.queue, stream.decoder.finish(nil)...)
			stream.finished = true
			stream.body.Close()
			break
		}
		if err != nil {
			stream.queue = append(stream.queue, stream.decoder.fail(err)...)
			stream.finished = true
			stream.body.Close()
			break
		}
		if data == "[DONE]" {
			stream.queue = append(stream.queue, stream.decoder.finish(nil)...)
			stream.finished = true
			stream.body.Close()
			break
		}
		if stream.recorder != nil {
			stream.recorder.AppendValueJSONL("04-openai-response.jsonl", json.RawMessage(data))
		}
		var chunk chatChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			stream.queue = append(stream.queue, stream.decoder.fail(fmt.Errorf("decode openai SSE chunk: %w", err))...)
			stream.finished = true
			stream.body.Close()
			break
		}
		stream.queue = append(stream.queue, stream.decoder.decode(&chunk)...)
		if stream.decoder.finished {
			stream.finished = true
			stream.body.Close()
		}
	}
	if len(stream.queue) > 0 {
		event := stream.queue[0]
		stream.queue = stream.queue[1:]
		return event, nil
	}
	return llm.ResponseEvent{}, io.EOF
}

// readSSEData 从 SSE 流中读取下一个 data 行并返回其载荷。
func readSSEData(reader *bufio.Reader) (string, error) {
	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "data:") {
				return strings.TrimSpace(strings.TrimPrefix(line, "data:")), nil
			}
			// 跳过空行、注释与 event 行。
			continue
		}
		if err != nil {
			return "", err
		}
	}
}

func reasoningContent(delta chatDelta) string {
	if delta.ReasoningContent != "" {
		return delta.ReasoningContent
	}
	return delta.Reasoning
}

func mapFinishReason(reason string) llm.StopReason {
	switch reason {
	case "length":
		return llm.StopReasonLength
	case "tool_calls":
		return llm.StopReasonToolUse
	case "content_filter":
		return llm.StopReasonError
	default:
		return llm.StopReasonStop
	}
}

func isJSONObject(value json.RawMessage) bool {
	if !json.Valid(value) {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(value, &object) == nil && object != nil
}
