export type Role = "student" | "teacher";

export type User = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  grade_level: string | null;
  section: string | null;
  roll_number: string | null;
  must_change_password: boolean;
  created_at: string;
};

export type LoginResponse = {
  token: string;
  user: User;
  expires_at: string;
};

export type Classroom = {
  id: string;
  name: string;
  subject_code: string | null;
  description: string;
  color: string;
  owner_teacher_id: string;
  owner_teacher_name: string;
  enrolment_code: string;
  student_count: number;
  created_at: string;
};

export type ClassroomTeachers = {
  owner: User;
  co_teachers: User[];
};

export type TeacherInvitePin = {
  invite_pin: string;
  expires_at: string;
};

export type ClassroomRoster = {
  classroom: Classroom;
  students: User[];
};

export type AssignmentStatus = "draft" | "published" | "closed";

export type Assignment = {
  id: string;
  classroom_id: string;
  classroom_name: string;
  title: string;
  instructions: string;
  due_at: string | null;
  max_points: number;
  grading_scheme: unknown;
  status: AssignmentStatus;
  created_at: string;
  updated_at: string;
};

export type SubmissionVersion = {
  id: string;
  version_number: number;
  doc_json: Record<string, unknown>;
  plaintext: string;
  change_note: string | null;
  late: boolean;
  created_at: string;
};

export type Grade = {
  id: string;
  points: number | null;
  grade_label: string | null;
  feedback: string;
  published: boolean;
  updated_at: string;
};

export type Submission = {
  id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  status: "draft" | "submitted" | "resubmitted" | "graded" | "withdrawn";
  version: SubmissionVersion | null;
  grade: Grade | null;
  submitted_at: string | null;
  updated_at: string;
};

export type SubmissionComment = {
  id: string;
  author_name: string;
  body: string;
  anchor: unknown | null;
  created_at: string;
};

export type GradeChange = {
  id: string;
  previous: unknown;
  current: unknown;
  changed_at: string;
};

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type AttendanceRecord = {
  student_id: string;
  student_name: string;
  status: AttendanceStatus | null;
  note: string;
  checked_in: boolean;
  present_percentage: number | null;
};

export type AttendanceDay = {
  classroom_id: string;
  day: string;
  records: AttendanceRecord[];
};

export type LiveSession = {
  id: string;
  classroom_id: string;
  classroom_name: string;
  module_id: string;
  module_name: string;
  duration_minutes: number;
  join_code: string;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
  server_now?: string;
  current_task: LiveSessionTask | null;
  student_task_state: LiveSessionTaskAcknowledgement | null;
  student_joined?: boolean;
};

export type LiveSessionTaskKind = "instruction" | "assignment" | "material" | "quiz";
export type LiveSessionTaskState = "opened" | "in_progress" | "completed" | "failed";

export type LiveSessionTask = {
  id: string;
  revision: number;
  kind: LiveSessionTaskKind;
  target_id: string | null;
  title: string;
  instructions: string;
  created_at: string;
};

export type LiveSessionTaskAcknowledgement = {
  revision: number;
  state: LiveSessionTaskState;
  updated_at: string;
};

export type LiveSessionResult = {
  score: number;
  elapsed_seconds: number;
  task_revision: number | null;
  submitted_at: string;
};

export type LiveSessionParticipant = {
  student_id: string;
  student_name: string;
  joined_at: string;
  last_seen_at: string;
  result: LiveSessionResult | null;
  task_state: LiveSessionTaskAcknowledgement | null;
};

export type LiveSessionHistoryItem = {
  session: LiveSession;
  participant_count: number;
  completed_count: number;
};

export type LiveSessionDetails = {
  session: LiveSession;
  participants: LiveSessionParticipant[];
  tasks: LiveSessionTask[];
  task_progress: LiveSessionTaskProgress[];
};

export type LiveSessionTaskParticipantProgress = {
  student_id: string;
  student_name: string;
  state: LiveSessionTaskAcknowledgement | null;
  result: LiveSessionResult | null;
};

export type LiveSessionTaskProgress = {
  task: LiveSessionTask;
  participants: LiveSessionTaskParticipantProgress[];
};

export type QuizQuestionKind = "single_choice" | "true_false" | "short_answer";
export type QuizDeliveryKind = "homework" | "live";
export type QuizQuestionInput = { id?: string | null; kind: QuizQuestionKind; prompt: string; options: string[]; canonical_answer: unknown; max_points: number; required: boolean };
export type QuizQuestion = QuizQuestionInput & { id: string; position: number };
export type StudentQuizQuestion = Omit<QuizQuestion, "canonical_answer">;
export type Quiz = { id: string; classroom_id: string; classroom_name: string; title: string; instructions: string; time_limit_minutes: number | null; archived: boolean; published_version: number | null; questions: QuizQuestion[]; updated_at: string };
export type QuizDelivery = { id: string; quiz_id: string; version_id: string; classroom_id: string; classroom_name: string; title: string; instructions: string; kind: QuizDeliveryKind; time_limit_minutes: number | null; total_points: number; opens_at: string | null; due_at: string | null; results_released_at: string | null; attempt_id: string | null; attempt_state: string | null };
export type QuizResponse = { question_id: string; answer: unknown; points: number | null; feedback: string; correct: boolean | null; canonical_answer: unknown | null };
export type QuizAttempt = { id: string; student_id: string; student_name: string; delivery: QuizDelivery; questions: StudentQuizQuestion[]; responses: QuizResponse[]; started_at: string; expires_at: string | null; submitted_at: string | null; score: number | null; max_points: number; manual_grading_complete: boolean; released: boolean; server_now: string };
export type QuizQuestionStatistic = { question_id: string; prompt: string; graded_count: number; correct_percent: number; partial_percent: number };
export type QuizStatistics = { assigned_count: number; started_count: number; submitted_count: number; graded_count: number; highest: number | null; lowest: number | null; mean: number | null; median: number | null; lower_quartile: number | null; upper_quartile: number | null; distribution: number[]; questions: QuizQuestionStatistic[]; most_correct_question_id: string | null; most_incorrect_question_id: string | null };

export type DashboardStats = {
  students: number;
  classrooms: number;
  pending_submissions: number;
  ungraded_submissions: number;
  present_today: number;
};

export type NodeKind = "folder" | "note" | "pdf" | "deck";

export type StudyNode = {
  id: string;
  owner_id: string | null;
  parent_id: string | null;
  classroom_id: string | null;
  name: string;
  kind: NodeKind;
  position: number;
  icon: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteBody = {
  doc_json: Record<string, unknown>;
  plaintext: string;
  updated_at: string;
};

export type AiSettings = {
  base_url?: string;
  model: string;
  has_key: boolean;
  reachable: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GradebookSuggestion = {
  student_id: string;
  assignment_id: string;
  points: number;
};

export type Card = {
  id: string;
  deck_node_id: string;
  front: string;
  back: string;
  source_node_id: string | null;
  source_excerpt: string | null;
  generated_by: "manual" | "ai";
};
