import { useParams } from "react-router";

export function YearRoute() {
  const { year } = useParams();
  return <h1 className="text-2xl font-semibold">Year {year}</h1>;
}
