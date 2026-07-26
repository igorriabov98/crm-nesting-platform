ALTER TABLE "nesting"."Part"
ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "needsReviewReason" TEXT;
