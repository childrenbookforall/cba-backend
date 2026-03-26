/*
  Warnings:

  - A unique constraint covering the columns `[flaggedById,postId]` on the table `Flag` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[flaggedById,commentId]` on the table `Flag` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Flag_flaggedById_postId_key" ON "Flag"("flaggedById", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_flaggedById_commentId_key" ON "Flag"("flaggedById", "commentId");
