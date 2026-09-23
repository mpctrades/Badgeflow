-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "appEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultColor" TEXT NOT NULL DEFAULT '#E33C2B',
    "defaultPosition" TEXT NOT NULL DEFAULT 'top-left',
    "defaultSize" INTEGER NOT NULL DEFAULT 12,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "embedConfirmedAt" DATETIME
);
INSERT INTO "new_ShopSettings" ("appEnabled", "defaultColor", "defaultPosition", "defaultSize", "shop") SELECT "appEnabled", "defaultColor", "defaultPosition", "defaultSize", "shop" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
