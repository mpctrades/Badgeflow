-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "appEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultColor" TEXT NOT NULL DEFAULT '#E33C2B',
    "defaultPosition" TEXT NOT NULL DEFAULT 'top-left',
    "defaultSize" INTEGER NOT NULL DEFAULT 12
);
