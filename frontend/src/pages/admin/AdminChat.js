import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export default function AdminChat() {
  return <section data-testid="admin-chat-page">
    <h2 className="mb-4 font-display text-lg font-bold">Messages clients</h2>
    <ChatWorkspace admin />
  </section>;
}
