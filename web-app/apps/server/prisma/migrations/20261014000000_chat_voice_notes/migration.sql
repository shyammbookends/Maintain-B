-- Team chat voice notes are attachments owned by a chat message.
ALTER TYPE "AttachmentOwnerType" ADD VALUE IF NOT EXISTS 'CHAT_MESSAGE';
