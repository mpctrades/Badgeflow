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
    "embedConfirmedAt" DATETIME,
    "hideSoldOut" BOOLEAN NOT NULL DEFAULT true,
    "oneBadgePerProduct" BOOLEAN NOT NULL DEFAULT true,
    "shrinkOnMobile" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_ShopSettings" ("appEnabled", "defaultColor", "defaultPosition", "defaultSize", "embedConfirmedAt", "plan", "shop") SELECT "appEnabled", "defaultColor", "defaultPosition", "defaultSize", "embedConfirmedAt", "plan", "shop" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
