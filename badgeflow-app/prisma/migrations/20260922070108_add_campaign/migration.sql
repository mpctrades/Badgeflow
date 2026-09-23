-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "badgeLabel" TEXT NOT NULL,
    "badgeText" TEXT NOT NULL,
    "badgeColor" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 12,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Campaign_shop_idx" ON "Campaign"("shop");
