-- CreateEnum
CREATE TYPE "Badge" AS ENUM ('host', 'co_host', 'supporter', 'member', 'member_sabbatical');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "badges" "Badge"[] DEFAULT ARRAY[]::"Badge"[];
