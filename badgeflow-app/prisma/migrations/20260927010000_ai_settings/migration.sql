ALTER TABLE "ShopSettings" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiKeyCipher" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiKeyHint" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiVerifiedAt" DATETIME;
