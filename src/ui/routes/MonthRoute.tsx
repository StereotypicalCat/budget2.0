import { useParams } from "react-router";

export function MonthRoute() {
  const { monthId } = useParams();
  return <h1 className="text-2xl font-semibold">{monthId}</h1>;
}
