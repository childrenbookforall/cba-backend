-- CreateTable
CREATE TABLE "NotifiedReading" (
    "id" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotifiedReading_pkey" PRIMARY KEY ("id")
);
