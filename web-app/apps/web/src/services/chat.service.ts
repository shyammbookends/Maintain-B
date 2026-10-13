import type {
  ApiResponse,
  ChatMessageDto,
  ChatMessageInput,
  ChatListScope,
  ChatMessagesPage,
  ChatPerson,
  ConversationListItem,
  StartConversationInput,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { http } from './http'

/** Chats poll: the list every 15 s, the open chat every 4 s (see ChatThread). */
export const chatKeys = {
  list: ['chats'] as const,
  scoped: (scope: ChatListScope) => ['chats', 'list', scope] as const,
  unread: ['chats', 'unread'] as const,
  people: (q: string) => ['chats', 'people', q] as const,
}

/** "mine": chats I'm in. "all" (admins only): plus the chats I oversee, flagged viewOnly. */
export function useConversations(scope: ChatListScope = 'mine', enabled = true) {
  return useQuery({
    queryKey: chatKeys.scoped(scope),
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<ConversationListItem[]>>('/chats', {
          query: scope === 'all' ? { scope } : {},
          signal,
        })
        .then((r) => r.data),
    refetchInterval: 15_000,
    enabled,
  })
}

export function useChatUnread() {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<{ count: number }>>('/chats/unread', { signal })
        .then((r) => r.data.count),
    refetchInterval: 30_000,
  })
}

export function useChatPeople(q: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.people(q),
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<ChatPerson[]>>('/chats/people', { query: { q }, signal })
        .then((r) => r.data),
    enabled,
    staleTime: 60_000,
  })
}

export const chatApi = {
  start: (input: StartConversationInput) =>
    http.post<ApiResponse<{ id: string }>>('/chats', input).then((r) => r.data),
  messages: (id: string, query: { before?: string; after?: string } = {}, signal?: AbortSignal) =>
    http
      .get<ApiResponse<ChatMessagesPage>>(`/chats/${id}/messages`, { query, signal })
      .then((r) => r.data),
  send: (id: string, input: ChatMessageInput) =>
    http.post<ApiResponse<ChatMessageDto>>(`/chats/${id}/messages`, input).then((r) => r.data),
  /** Voice message: the recording, its length and an optional caption. */
  sendVoice: (id: string, file: File, durationSec: number, body = '') => {
    const form = new FormData()
    // Fields first: the server reads them alongside the file.
    form.append('durationSec', String(durationSec))
    form.append('body', body)
    form.append('files', file, file.name)
    return http
      .post<ApiResponse<ChatMessageDto>>(`/chats/${id}/voice`, form, { noQueue: true })
      .then((r) => r.data)
  },
  remove: (id: string, messageId: string) =>
    http.delete<void>(`/chats/${id}/messages/${messageId}`),
  read: (id: string) => http.post<void>(`/chats/${id}/read`),
  leave: (id: string) => http.post<void>(`/chats/${id}/leave`),
  addMembers: (id: string, userIds: string[]) =>
    http.post<void>(`/chats/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => http.delete<void>(`/chats/${id}/members/${userId}`),
}
