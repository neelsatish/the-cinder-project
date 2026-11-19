import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Metric,
  PageHeader,
  Panel,
  type Assignment,
  type Classroom,
  type DashboardStats,
} from "@cinder/ui";
import { formatDate } from "../teacherFiles";
import type { ClassroomFocus } from "./ClassroomsView";

const STATUS_LABEL: Record<Assignment["status"], string> = { draft: "Draft", published: "Published", closed: "Completed" };

export function OverviewView({
  stats,
  assignments,
  classrooms,
  onOpen,
}: {
  stats: DashboardStats;
  assignments: Assignment[];
  classrooms: Classroom[];
  onOpen: (focus: ClassroomFocus) => void;
}) {
  const upcoming = [...assignments]
    .filter((item) => item.status !== "closed")
    .sort((left, right) => (left.due_at ? Date.parse(left.due_at) : Infinity) - (right.due_at ? Date.parse(right.due_at) : Infinity))
    .slice(0, 8);
  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Overview" />
        <div className="metrics">
          <Metric label="Students" value={stats.students} />
          <Metric label="Classrooms" value={stats.classrooms} />
          <Metric label="Work to mark" value={stats.ungraded_submissions} />
          <Metric label="Marked present today" value={stats.present_today} />
        </div>
        <div className="grid grid-main">
          <Panel title="Assignments" className="panel-flush">
            {upcoming.length ? (
              <div className="list">
                {upcoming.map((item) => (
                  <button
                    type="button"
                    className="list-item"
                    key={item.id}
                    onClick={() => onOpen({ classroomId: item.classroom_id, section: "assignments", assignmentId: item.id })}
                  >
                    <span className="list-icon"><Icon name="assignments" /></span>
                    <span className="list-copy">
                      <strong>{item.title}</strong>
                      <span>{item.classroom_name} · {item.due_at ? `Due ${formatDate(item.due_at)}` : "No due date"}</span>
                    </span>
                    {item.status === "draft" ? <Badge>{STATUS_LABEL.draft}</Badge> : null}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon="assignments" title="No open assignments" description="Assignments you set in a classroom appear here." />
            )}
          </Panel>
          <Panel title="Classrooms" className="panel-flush">
            {classrooms.length ? (
              <div className="list">
                {classrooms.map((room) => (
                  <div className="list-item" key={room.id}>
                    <span className="classroom-swatch" style={{ background: room.color }} aria-hidden="true" />
                    <button type="button" className="list-copy list-open" onClick={() => onOpen({ classroomId: room.id })}>
                      <strong>{room.name}</strong>
                      <span>{room.student_count} {room.student_count === 1 ? "student" : "students"}</span>
                    </button>
                    <Button size="small" variant="ghost" onClick={() => onOpen({ classroomId: room.id, section: "attendance" })}>Register</Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="classrooms" title="No classrooms yet" />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
