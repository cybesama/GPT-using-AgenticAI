"use client"

import Header from '@/components/Header';
import InputBar from '@/components/InputBar';
import MessageArea from '@/components/MessageArea';
import React, { useState, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface SearchInfo {
  stages: string[];
  query: string;
  urls: string[];
  error?: string;
}

export interface ToolApprovalInfo {
  toolName: string;
  query: string;
  threadId: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface Message {
  id: number;
  content: string;
  isUser: boolean;
  type: 'message' | 'tool_approval';
  isLoading?: boolean;
  searchInfo?: SearchInfo | null;
  toolApprovalInfo?: ToolApprovalInfo;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

const Home = () => {
  const [messages, setMessages] = useState<Message[]>([{
    id: 1,
    content: 'Hi there, how can I help you?',
    isUser: false,
    type: 'message',
  }]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const idCounterRef = useRef(1);

  const getNextId = () => {
    idCounterRef.current += 1;
    return idCounterRef.current;
  };

  // Insert a tool_approval message so the user can decide whether to allow the search.
  const handleApprovalNeeded = (threadId: string, toolCalls: ToolCall[]) => {
    const primaryCall = toolCalls[0];
    const query = (primaryCall?.args?.query as string) || "";
    const approvalId = getNextId();
    setMessages(prev => [...prev, {
      id: approvalId,
      content: "",
      isUser: false,
      type: 'tool_approval',
      toolApprovalInfo: {
        toolName: primaryCall?.name || "tavily_search_results_json",
        query,
        threadId,
        status: 'pending',
      },
    }]);
  };

  // Open an EventSource to `url` and stream events into the message at `aiResponseId`.
  // If the server signals tool_approval_needed, calls handleApprovalNeeded and closes the stream.
  const streamIntoMessage = (url: string, aiResponseId: number) => {
    let streamedContent = "";
    let searchData: SearchInfo | null = null;

    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'checkpoint') {
          setCheckpointId(data.checkpoint_id);

        } else if (data.type === 'content') {
          streamedContent += data.content;
          setMessages(prev => prev.map(msg =>
            msg.id === aiResponseId
              ? { ...msg, content: streamedContent, isLoading: false }
              : msg
          ));

        } else if (data.type === 'search_start') {
          const newSearchInfo: SearchInfo = { stages: ['searching'], query: data.query, urls: [] };
          searchData = newSearchInfo;
          setMessages(prev => prev.map(msg =>
            msg.id === aiResponseId
              ? { ...msg, searchInfo: newSearchInfo, isLoading: false }
              : msg
          ));

        } else if (data.type === 'search_results') {
          const urls: string[] = typeof data.urls === 'string' ? JSON.parse(data.urls) : data.urls;
          const newSearchInfo: SearchInfo = {
            stages: searchData ? [...searchData.stages, 'reading'] : ['reading'],
            query: searchData?.query || "",
            urls,
          };
          searchData = newSearchInfo;
          setMessages(prev => prev.map(msg =>
            msg.id === aiResponseId
              ? { ...msg, searchInfo: newSearchInfo, isLoading: false }
              : msg
          ));

        } else if (data.type === 'search_error') {
          const newSearchInfo: SearchInfo = {
            stages: searchData ? [...searchData.stages, 'error'] : ['error'],
            query: searchData?.query || "",
            urls: [],
            error: data.error,
          };
          searchData = newSearchInfo;
          setMessages(prev => prev.map(msg =>
            msg.id === aiResponseId
              ? { ...msg, searchInfo: newSearchInfo, isLoading: false }
              : msg
          ));

        } else if (data.type === 'tool_approval_needed') {
          eventSource.close();
          // Drop the empty AI placeholder if nothing was streamed into it
          if (!streamedContent) {
            setMessages(prev => prev.filter(msg => msg.id !== aiResponseId));
          } else {
            setMessages(prev => prev.map(msg =>
              msg.id === aiResponseId ? { ...msg, isLoading: false } : msg
            ));
          }
          handleApprovalNeeded(data.thread_id, data.tool_calls);

        } else if (data.type === 'end') {
          if (searchData) {
            const finalSearchInfo = { ...searchData, stages: [...searchData.stages, 'writing'] };
            setMessages(prev => prev.map(msg =>
              msg.id === aiResponseId
                ? { ...msg, searchInfo: finalSearchInfo, isLoading: false }
                : msg
            ));
          }
          eventSource.close();
        }
      } catch (err) {
        console.error("Error parsing event data:", err, event.data);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (!streamedContent) {
        setMessages(prev => prev.map(msg =>
          msg.id === aiResponseId
            ? { ...msg, content: "Sorry, there was an error processing your request.", isLoading: false }
            : msg
        ));
      }
    };
  };

  // Called by MessageArea when user clicks Approve or Deny on a tool_approval message.
  const handleToolDecision = (approved: boolean, threadId: string, approvalMessageId: number) => {
    // Mark the approval card as decided
    setMessages(prev => prev.map(msg =>
      msg.id === approvalMessageId && msg.toolApprovalInfo
        ? { ...msg, toolApprovalInfo: { ...msg.toolApprovalInfo, status: approved ? 'approved' : 'rejected' } }
        : msg
    ));

    // Create a new AI message for the continuation response
    const continuationId = getNextId();
    setMessages(prev => [...prev, {
      id: continuationId,
      content: "",
      isUser: false,
      type: 'message',
      isLoading: true,
      searchInfo: { stages: [], query: "", urls: [] },
    }]);

    const url = `${API_URL}/continue_stream/${encodeURIComponent(threadId)}?approved=${approved}`;
    streamIntoMessage(url, continuationId);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentMessage.trim()) return;

    const userMsgId = getNextId();
    setMessages(prev => [...prev, {
      id: userMsgId,
      content: currentMessage,
      isUser: true,
      type: 'message',
    }]);

    const userInput = currentMessage;
    setCurrentMessage("");

    const aiResponseId = getNextId();
    setMessages(prev => [...prev, {
      id: aiResponseId,
      content: "",
      isUser: false,
      type: 'message',
      isLoading: true,
      searchInfo: { stages: [], query: "", urls: [] },
    }]);

    let url = `${API_URL}/chat_stream/${encodeURIComponent(userInput)}`;
    if (checkpointId) {
      url += `?checkpoint_id=${encodeURIComponent(checkpointId)}`;
    }

    streamIntoMessage(url, aiResponseId);
  };

  return (
    <div className="flex justify-center bg-gray-100 min-h-screen py-8 px-4">
      <div className="w-[70%] bg-white flex flex-col rounded-xl shadow-lg border border-gray-100 overflow-hidden h-[90vh]">
        <Header />
        <MessageArea messages={messages} onToolDecision={handleToolDecision} />
        <InputBar currentMessage={currentMessage} setCurrentMessage={setCurrentMessage} onSubmit={handleSubmit} />
      </div>
    </div>
  );
};

export default Home;
