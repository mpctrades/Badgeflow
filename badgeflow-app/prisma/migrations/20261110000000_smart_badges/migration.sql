-- Smart badges: automatic sale / new badges, badge shapes.
ALTER TABLE "Campaign" ADD COLUMN "badgeKind" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "Campaign" ADD COLUMN "minDiscount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Campaign" ADD COLUMN "newDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Campaign" ADD COLUMN "shape" TEXT NOT NULL DEFAULT 'rounded';
