-- CreateTable
CREATE TABLE "resend_logs" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resend_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resend_logs_memberId_idx" ON "resend_logs"("memberId");

-- CreateIndex
CREATE INDEX "resend_logs_createdAt_idx" ON "resend_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "resend_logs" ADD CONSTRAINT "resend_logs_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
