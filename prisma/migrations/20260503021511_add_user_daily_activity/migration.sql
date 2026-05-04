-- CreateTable
CREATE TABLE "UserDailyActivity" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "UserDailyActivity_pkey" PRIMARY KEY ("userId","date")
);

-- CreateIndex
CREATE INDEX "UserDailyActivity_date_idx" ON "UserDailyActivity"("date");
