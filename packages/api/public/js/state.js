// Shared mutable state for the AgenticMail web UI.
// One module, imported wherever state is read or written.
export const state = {
  masterKey: null,
  agents: [],
  selectedAgent: null,
  selectedFolder: 'inbox',     // 'inbox' | 'sent' | 'drafts' | 'starred' | 'spam' | 'trash' | 'all'
  messages: [],
  selectedUid: null,
  currentMessage: null,
  composeReplyContext: null,
  searchQuery: '',
  sseControllers: [],
  unread: {},                  // { [agentId]: count }
};

export const API_URL = window.location.origin;
