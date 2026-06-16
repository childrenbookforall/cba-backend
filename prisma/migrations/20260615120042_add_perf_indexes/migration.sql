-- DropIndex
DROP INDEX "Notification_recipientId_idx";

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Notification_recipientId_isRead_idx" ON "Notification"("recipientId", "isRead");

-- CreateIndex
CREATE INDEX "Post_isPinned_idx" ON "Post"("isPinned");
