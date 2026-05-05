-- CreateTable
CREATE TABLE "SiteNotification" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "linkText" TEXT,
    "linkUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteNotification_pkey" PRIMARY KEY ("id")
);
