-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" SERIAL NOT NULL,
    "alertId" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_phoneNumber_fkey" FOREIGN KEY ("phoneNumber") REFERENCES "User"("phoneNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
