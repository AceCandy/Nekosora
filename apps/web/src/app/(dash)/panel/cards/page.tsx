import { getTranslations } from "next-intl/server";
import CardsManager from "@/features/panel/cards/CardsManager";
import { listMyCards } from "@/features/panel/cards/actions";
import { PageHeader } from "@/shared/components/PageHeader";
import { CreditCard } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const t = await getTranslations("panel.cards");
  const tn = await getTranslations("nav");
  const cards = await listMyCards();
  return (
    <div className="space-y-6">
      <PageHeader icon={CreditCard} title={tn("cards")} desc={t("desc")} />
      <CardsManager initialCards={cards} />
    </div>
  );
}
