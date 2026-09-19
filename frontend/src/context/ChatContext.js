import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const ChatContext = createContext({ count: 0, refreshUnread: () => {} });
export const ChatProvider = ({ children }) => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const refreshUnread = useCallback(async () => {
    if (!user || document.hidden) return;
    try { const { data } = await api.get("/chat/unread"); setCount(data.count); } catch (_) {}
  }, [user]);
  useEffect(() => {
    setCount(0);
    if (!user) return;
    let stopped = false, timer;
    const poll = async () => { await refreshUnread(); if (!stopped) timer = setTimeout(poll, 20000); };
    poll();
    document.addEventListener("visibilitychange", refreshUnread);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", refreshUnread); };
  }, [user, refreshUnread]);
  return <ChatContext.Provider value={{ count: user ? count : 0, refreshUnread }}>{children}</ChatContext.Provider>;
};
export const useChat = () => useContext(ChatContext);
