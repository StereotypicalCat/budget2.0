import { useParams } from "react-router";

export function PostMonthRoute() {
  const { postId, monthId } = useParams();
  return (
    <h1 className="text-2xl font-semibold">
      Post {postId} — {monthId}
    </h1>
  );
}
