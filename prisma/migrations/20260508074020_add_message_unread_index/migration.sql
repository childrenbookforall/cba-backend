-- CreateIndex
CREATE INDEX "Message_conversationId_senderId_isRead_idx" ON "Message"("conversationId", "senderId", "isRead");
