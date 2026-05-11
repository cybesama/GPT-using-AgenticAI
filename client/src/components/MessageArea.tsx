import React from "react";

interface SearchInfo {
  stages: string[];
  query: string;
  urls: string[];
  error?: string;
}

interface ToolApprovalInfo {
  toolName: string;
  query: string;
  threadId: string;
  status: 'pending' | 'approved' | 'rejected';
}

interface Message {
  id: number;
  content: string;
  isUser: boolean;
  type: 'message' | 'tool_approval';
  isLoading?: boolean;
  searchInfo?: SearchInfo | null;
  toolApprovalInfo?: ToolApprovalInfo;
}

interface MessageAreaProps {
  messages: Message[];
  onToolDecision: (approved: boolean, threadId: string, messageId: number) => void;
}

interface SearchStagesProps {
  searchInfo: SearchInfo | null | undefined;
}

const PremiumTypingAnimation = () => (
  <div className="flex items-center">
    <div className="flex items-center space-x-1.5">
      <div className="w-1.5 h-1.5 bg-gray-400/70 rounded-full animate-pulse" style={{ animationDuration: "1s", animationDelay: "0ms" }} />
      <div className="w-1.5 h-1.5 bg-gray-400/70 rounded-full animate-pulse" style={{ animationDuration: "1s", animationDelay: "300ms" }} />
      <div className="w-1.5 h-1.5 bg-gray-400/70 rounded-full animate-pulse" style={{ animationDuration: "1s", animationDelay: "600ms" }} />
    </div>
  </div>
);

const SearchStages = ({ searchInfo }: SearchStagesProps) => {
  if (!searchInfo || !searchInfo.stages?.length) return null;

  return (
    <div className="mb-3 mt-1 relative pl-4">
      <div className="flex flex-col space-y-4 text-sm text-gray-700">

        {searchInfo.stages.includes("searching") && (
          <div className="relative">
            <div className="absolute -left-3 top-1 w-2.5 h-2.5 bg-teal-400 rounded-full z-10 shadow-sm" />
            {searchInfo.stages.includes("reading") && (
              <div className="absolute -left-[7px] top-3 w-0.5 h-[calc(100%+1rem)] bg-gradient-to-b from-teal-300 to-teal-200" />
            )}
            <div className="flex flex-col">
              <span className="font-medium mb-2 ml-2">Searching the web</span>
              <div className="flex flex-wrap gap-2 pl-2 mt-1">
                <div className="bg-gray-100 text-xs px-3 py-1.5 rounded border border-gray-200 inline-flex items-center">
                  {searchInfo.query}
                </div>
              </div>
            </div>
          </div>
        )}

        {searchInfo.stages.includes("reading") && (
          <div className="relative">
            <div className="absolute -left-3 top-1 w-2.5 h-2.5 bg-teal-400 rounded-full z-10 shadow-sm" />
            <div className="flex flex-col">
              <span className="font-medium mb-2 ml-2">Reading</span>
              {searchInfo.urls?.length > 0 && (
                <div className="pl-2 space-y-1">
                  <div className="flex flex-wrap gap-2">
                    {searchInfo.urls.map((url, index) => (
                      <div key={index} className="bg-gray-100 text-xs px-3 py-1.5 rounded border border-gray-200 truncate max-w-[200px]">
                        {url}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {searchInfo.stages.includes("writing") && (
          <div className="relative">
            <div className="absolute -left-3 top-1 w-2.5 h-2.5 bg-teal-400 rounded-full z-10 shadow-sm" />
            <span className="font-medium pl-2">Writing answer</span>
          </div>
        )}

        {searchInfo.stages.includes("error") && (
          <div className="relative">
            <div className="absolute -left-3 top-1 w-2.5 h-2.5 bg-red-400 rounded-full z-10 shadow-sm" />
            <span className="font-medium">Search error</span>
            <div className="pl-4 text-xs text-red-500 mt-1">
              {searchInfo.error || "An error occurred during search."}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

interface ToolApprovalCardProps {
  message: Message;
  onToolDecision: (approved: boolean, threadId: string, messageId: number) => void;
}

const ToolApprovalCard = ({ message, onToolDecision }: ToolApprovalCardProps) => {
  const info = message.toolApprovalInfo;
  if (!info) return null;

  const isPending = info.status === 'pending';

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm max-w-md">
      <div className="flex items-start gap-2 mb-3">
        <div className="mt-0.5 w-4 h-4 rounded-full bg-amber-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Tool call requested</p>
          <p className="text-xs text-amber-700 mt-0.5">
            The AI wants to search the web
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-amber-200 px-3 py-2 mb-3">
        <p className="text-xs text-gray-500 mb-1">Query</p>
        <p className="text-sm text-gray-800 font-medium">{info.query || info.toolName}</p>
      </div>

      {isPending ? (
        <div className="flex gap-2">
          <button
            onClick={() => onToolDecision(true, info.threadId, message.id)}
            className="flex-1 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium py-1.5 px-3 rounded-lg transition-colors"
          >
            Allow search
          </button>
          <button
            onClick={() => onToolDecision(false, info.threadId, message.id)}
            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium py-1.5 px-3 rounded-lg border border-gray-300 transition-colors"
          >
            Deny
          </button>
        </div>
      ) : (
        <div className={`text-xs font-medium px-3 py-1.5 rounded-lg text-center ${
          info.status === 'approved'
            ? 'bg-teal-100 text-teal-800'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {info.status === 'approved' ? '✓ Search allowed' : '✗ Search denied'}
        </div>
      )}
    </div>
  );
};

const MessageArea = ({ messages, onToolDecision }: MessageAreaProps) => {
  return (
    <div className="flex-grow overflow-y-auto bg-[#FCFCF8] border-b border-gray-100" style={{ minHeight: 0 }}>
      <div className="max-w-4xl mx-auto p-6">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"} mb-5`}>
            <div className="flex flex-col max-w-md">

              {message.type === 'tool_approval' ? (
                <ToolApprovalCard message={message} onToolDecision={onToolDecision} />
              ) : (
                <>
                  {!message.isUser && message.searchInfo && (
                    <SearchStages searchInfo={message.searchInfo} />
                  )}
                  <div className={`rounded-lg py-3 px-5 ${
                    message.isUser
                      ? "bg-gradient-to-br from-[#5E507F] to-[#4A3F71] text-white rounded-br-none shadow-md"
                      : "bg-[#F3F3EE] text-gray-800 border border-gray-200 rounded-bl-none shadow-sm"
                  }`}>
                    {message.isLoading ? (
                      <PremiumTypingAnimation />
                    ) : (
                      message.content || (
                        <span className="text-gray-400 text-xs italic">Waiting for response...</span>
                      )
                    )}
                  </div>
                </>
              )}

            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MessageArea;
