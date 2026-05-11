from typing import TypedDict, Annotated, Optional
from langgraph.graph import add_messages, StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessageChunk, ToolMessage
from dotenv import load_dotenv
from langchain_community.tools.tavily_search import TavilySearchResults
from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from uuid import uuid4
from langgraph.checkpoint.memory import MemorySaver

load_dotenv()

memory = MemorySaver()

class State(TypedDict):
    messages: Annotated[list, add_messages]

search_tool = TavilySearchResults(max_results=4)
tools = [search_tool]

llm = ChatOpenAI(model="gpt-4o")
llm_with_tools = llm.bind_tools(tools=tools)

async def model(state: State):
    result = await llm_with_tools.ainvoke(state["messages"])
    return {"messages": [result]}

async def tools_router(state: State):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0:
        return "tool_node"
    return END

async def tool_node(state):
    tool_calls = state["messages"][-1].tool_calls
    tool_messages = []
    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        tool_id = tool_call["id"]
        if tool_name == "tavily_search_results_json":
            search_results = await search_tool.ainvoke(tool_args)
            tool_messages.append(ToolMessage(
                content=str(search_results),
                tool_call_id=tool_id,
                name=tool_name
            ))
    return {"messages": tool_messages}

graph_builder = StateGraph(State)
graph_builder.add_node("model", model)
graph_builder.add_node("tool_node", tool_node)
graph_builder.set_entry_point("model")
graph_builder.add_conditional_edges("model", tools_router)
graph_builder.add_edge("tool_node", "model")

# Pause before tool_node so the user can approve or reject the tool call
graph = graph_builder.compile(checkpointer=memory, interrupt_before=["tool_node"])

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)

def serialise_ai_message_chunk(chunk):
    if isinstance(chunk, AIMessageChunk):
        return chunk.content
    raise TypeError(f"Object of type {type(chunk).__name__} is not correctly formatted")

def safe_json_str(s: str) -> str:
    """Escape a string for embedding inside a JSON string value."""
    return json.dumps(s)[1:-1]

async def process_stream_events(events):
    """Convert LangGraph astream_events into SSE data strings."""
    async for event in events:
        event_type = event["event"]

        if event_type == "on_chat_model_stream":
            content = serialise_ai_message_chunk(event["data"]["chunk"])
            if content:
                yield f'data: {{"type": "content", "content": "{safe_json_str(content)}"}}\n\n'

        elif event_type == "on_chat_model_end":
            tool_calls = getattr(event["data"]["output"], "tool_calls", [])
            search_calls = [c for c in tool_calls if c["name"] == "tavily_search_results_json"]
            if search_calls:
                query = search_calls[0]["args"].get("query", "")
                yield f'data: {{"type": "search_start", "query": "{safe_json_str(query)}"}}\n\n'

        elif event_type == "on_tool_end" and event["name"] == "tavily_search_results_json":
            output = event["data"]["output"]
            if isinstance(output, list):
                urls = [item["url"] for item in output if isinstance(item, dict) and "url" in item]
                yield f'data: {{"type": "search_results", "urls": {json.dumps(urls)}}}\n\n'

async def check_and_emit_approval(config: dict, thread_id: str):
    """After streaming ends, emit tool_approval_needed if graph is paused, else emit end."""
    state = await graph.aget_state(config)
    if state.next and "tool_node" in state.next:
        last_msg = state.values["messages"][-1]
        tool_calls = getattr(last_msg, "tool_calls", [])
        tool_info = [{"name": tc["name"], "args": tc["args"]} for tc in tool_calls]
        yield f'data: {{"type": "tool_approval_needed", "thread_id": "{thread_id}", "tool_calls": {json.dumps(tool_info)}}}\n\n'
    else:
        yield 'data: {"type": "end"}\n\n'

async def generate_chat_responses(message: str, checkpoint_id: Optional[str] = None):
    thread_id = str(uuid4()) if checkpoint_id is None else checkpoint_id
    config = {"configurable": {"thread_id": thread_id}}

    if checkpoint_id is None:
        yield f'data: {{"type": "checkpoint", "checkpoint_id": "{thread_id}"}}\n\n'

    events = graph.astream_events(
        {"messages": [HumanMessage(content=message)]},
        version="v2",
        config=config
    )
    async for chunk in process_stream_events(events):
        yield chunk

    async for chunk in check_and_emit_approval(config, thread_id):
        yield chunk

async def continue_after_decision(thread_id: str, approved: bool):
    config = {"configurable": {"thread_id": thread_id}}

    if approved:
        # Emit search_start immediately — tool_node is about to run
        state = await graph.aget_state(config)
        last_msg = state.values["messages"][-1]
        for tc in getattr(last_msg, "tool_calls", []):
            if tc["name"] == "tavily_search_results_json":
                query = tc["args"].get("query", "")
                yield f'data: {{"type": "search_start", "query": "{safe_json_str(query)}"}}\n\n'
    else:
        # Inject rejection ToolMessages and advance past tool_node so model responds next
        state = await graph.aget_state(config)
        last_msg = state.values["messages"][-1]
        rejection_msgs = [
            ToolMessage(
                content="The user declined to run this search.",
                tool_call_id=tc["id"],
                name=tc["name"]
            )
            for tc in getattr(last_msg, "tool_calls", [])
        ]
        await graph.aupdate_state(config, {"messages": rejection_msgs}, as_node="tool_node")

    events = graph.astream_events(None, version="v2", config=config)
    async for chunk in process_stream_events(events):
        yield chunk

    async for chunk in check_and_emit_approval(config, thread_id):
        yield chunk

@app.get("/chat_stream/{message}")
async def chat_stream(message: str, checkpoint_id: Optional[str] = Query(None)):
    return StreamingResponse(
        generate_chat_responses(message, checkpoint_id),
        media_type="text/event-stream"
    )

@app.get("/continue_stream/{thread_id}")
async def continue_stream(thread_id: str, approved: bool = Query(...)):
    return StreamingResponse(
        continue_after_decision(thread_id, approved),
        media_type="text/event-stream"
    )
