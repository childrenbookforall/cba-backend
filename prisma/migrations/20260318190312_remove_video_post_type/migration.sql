/*
  Warnings:

  - The values [video] on the enum `PostType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PostType_new" AS ENUM ('text', 'link', 'photo');
ALTER TABLE "Post" ALTER COLUMN "type" TYPE "PostType_new" USING ("type"::text::"PostType_new");
ALTER TYPE "PostType" RENAME TO "PostType_old";
ALTER TYPE "PostType_new" RENAME TO "PostType";
DROP TYPE "public"."PostType_old";
COMMIT;

-- DropEnum
DROP TYPE "BookTagCategory";
