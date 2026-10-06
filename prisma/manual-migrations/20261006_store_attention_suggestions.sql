-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "attentionSuggestions" JSONB,
ADD COLUMN     "attentionSuggestionsComputedAt" TIMESTAMP(3);

