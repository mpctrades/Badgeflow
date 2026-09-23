-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "badgeLabel" TEXT NOT NULL,
    "badgeText" TEXT NOT NULL,
    "badgeColor" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 12,
    "mobilePosition" TEXT,
    "mobileSize" INTEGER,
    "targetType" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL DEFAULT '',
    "targetValue" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Campaign" ("badgeColor", "badgeLabel", "badgeText", "createdAt", "endAt", "id", "position", "shop", "size", "startAt", "status", "targetType", "targetValue", "updatedAt") SELECT "badgeColor", "badgeLabel", "badgeText", "createdAt", "endAt", "id", "position", "shop", "size", "startAt", "status", "targetType", "targetValue", "updatedAt" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_shop_idx" ON "Campaign"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
