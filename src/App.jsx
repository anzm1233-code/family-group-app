import GroupApp from "./GroupApp";
import FeedbackAdmin from "./FeedbackAdmin";

export default function App() {
  const isFeedbackAdmin = window.location.pathname === "/admin/feedback";
  return (
    <div className="page">
      {isFeedbackAdmin ? <FeedbackAdmin /> : <GroupApp />}
    </div>
  );
}
