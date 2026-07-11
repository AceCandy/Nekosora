import CardsManager from "@/features/panel/cards/CardsManager";
import { listMyCards } from "@/features/panel/cards/actions";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const cards = await listMyCards();
  return (
    <CardsManager initialCards={cards} />
  );
}
