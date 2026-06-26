import CardsManager from "@/features/panel/cards/CardsManager";
import { listMyCards } from "@/features/panel/cards/actions";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const cards = await listMyCards();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <CardsManager initialCards={cards} />
    </div>
  );
}
