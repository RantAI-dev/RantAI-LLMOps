export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatSession = {
  id: string;
  title: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
