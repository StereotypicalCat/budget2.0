import { useParams } from "react-router";

export function PostYearRoute() {
  const { postId, year } = useParams();
  return (
    <h1 className="text-2xl font-semibold">
      Post {postId} — Year {year}
    </h1>
  );
}
