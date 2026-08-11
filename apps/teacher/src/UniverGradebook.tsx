import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  LocaleType,
  LogLevel,
  mergeLocales,
  Univer,
  type IWorkbookData,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { Assignment, User } from "@cinder/ui";

export type WorkbookCellValue = string | number | boolean | null;

export type GradebookAction =
  | {
      type: "set_grade";
      student_id: string;
      assignment_id: string;
      points: number;
    }
  | {
      type: "add_column";
      title: string;
      assignment_id?: string;
      values?: Array<{ student_id: string; value: WorkbookCellValue }>;
    }
  | {
      type: "set_cell";
      sheet: string;
      cell: string;
      value: WorkbookCellValue;
    };

export type GradebookAiContext = {
  active_sheet: string;
  sheets: Array<{
    name: string;
    range: string;
    values: Array<Array<WorkbookCellValue>>;
  }>;
};

export type UniverGradebookHandle = {
  getAiContext: () => GradebookAiContext;
  applyActions: (actions: GradebookAction[]) => {
    applied: number;
    rejected: string[];
  };
};

type Props = {
  classroomId: string;
  classroomName: string;
  roster: User[];
  assignments: Assignment[];
  scores: Record<string, string>;
  submitted: (studentId: string, assignmentId: string) => boolean;
  onScoreChange: (
    studentId: string,
    assignment: Assignment,
    value: string,
  ) => void;
};

const storageKey = (classroomId: string) =>
  `cinder.teacher.workbook.${classroomId}`;
const EMPTY_AI_CONTEXT: GradebookAiContext = {
  active_sheet: "Gradebook",
  sheets: [],
};

function createSheetUniver(container: HTMLDivElement) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(sheetsEnUS) },
  });
  const preset = UniverSheetsCorePreset({
    container,
    header: true,
    toolbar: true,
    formulaBar: true,
    footer: { sheetBar: true, statisticBar: true, zoomSlider: true },
  });
  preset.plugins.forEach((entry) => {
    const [plugin, options] = Array.isArray(entry)
      ? entry
      : [entry, undefined];
    univer.registerPlugin(plugin, options);
  });
  return { univer, univerAPI: FUniver.newAPI(univer) };
}

function workbookData(props: Props): Partial<IWorkbookData> {
  let saved: Partial<IWorkbookData> | null = null;
  try {
    saved = JSON.parse(
      localStorage.getItem(storageKey(props.classroomId)) ?? "null",
    );
  } catch {
    // A damaged local workbook should not stop the gradebook from opening.
  }
  const id = saved?.id ?? `cinder-gradebook-${props.classroomId}`;
  const sheetId = "cinder-gradebook";
  const data: Partial<IWorkbookData> = saved ?? {
    id,
    name: `${props.classroomName} gradebook`,
    appVersion: "0.25.1",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [sheetId],
    sheets: {},
  };
  data.id = id;
  data.name = `${props.classroomName} gradebook`;
  data.sheetOrder = data.sheetOrder?.includes(sheetId)
    ? data.sheetOrder
    : [sheetId, ...(data.sheetOrder ?? [])];
  data.sheets ??= {};
  const sheet = data.sheets[sheetId] ?? { id: sheetId, name: "Gradebook" };
  sheet.id = sheetId;
  sheet.name = "Gradebook";
  sheet.rowCount = Math.max(sheet.rowCount ?? 0, props.roster.length + 40, 120);
  sheet.columnCount = Math.max(
    sheet.columnCount ?? 0,
    props.assignments.length + 12,
    30,
  );
  sheet.cellData ??= {};
  sheet.cellData[0] ??= {};
  sheet.cellData[0][0] = {
    v: "Student",
    s: { bg: { rgb: "#f0e7de" }, bl: 1 },
  };
  sheet.cellData[0][1] = {
    v: "Username",
    s: { bg: { rgb: "#f0e7de" }, bl: 1 },
  };
  props.assignments.forEach((assignment, column) => {
    sheet.cellData![0]![column + 2] = {
      v: `${assignment.title} / ${assignment.max_points}`,
      s: { bg: { rgb: "#f0e7de" }, bl: 1 },
    };
  });
  props.roster.forEach((student, row) => {
    const rowIndex = row + 1;
    sheet.cellData![rowIndex] ??= {};
    sheet.cellData![rowIndex]![0] = { v: student.display_name };
    sheet.cellData![rowIndex]![1] = { v: student.username };
    props.assignments.forEach((assignment, column) => {
      const key = `${student.id}:${assignment.id}`;
      const value = props.submitted(student.id, assignment.id)
        ? props.scores[key]
        : "—";
      sheet.cellData![rowIndex]![column + 2] =
        value === ""
          ? { v: null }
          : {
              v: Number.isFinite(Number(value)) ? Number(value) : value,
            };
    });
  });
  data.sheets[sheetId] = sheet;
  return data;
}

function columnIndexFromA1(cell: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/i.exec(cell.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column: column - 1, row: Number(match[2]) - 1 };
}

export const UniverGradebook = forwardRef<UniverGradebookHandle, Props>(
  function UniverGradebook(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef(props);
    const getContextRef = useRef<() => GradebookAiContext>(
      () => EMPTY_AI_CONTEXT,
    );
    const applyActionsRef = useRef<
      (actions: GradebookAction[]) => {
        applied: number;
        rejected: string[];
      }
    >(() => ({ applied: 0, rejected: ["The spreadsheet is still opening."] }));
    propsRef.current = props;

    useImperativeHandle(
      ref,
      () => ({
        getAiContext: () => getContextRef.current(),
        applyActions: (actions) => applyActionsRef.current(actions),
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const { univer, univerAPI } = createSheetUniver(containerRef.current);
      const workbook = univerAPI.createWorkbook(workbookData(propsRef.current));
      const sheet = workbook.getSheetByName("Gradebook");
      sheet?.setColumnWidth(0, 190);
      sheet?.setColumnWidth(1, 125);
      if (sheet && propsRef.current.assignments.length) {
        sheet.setColumnWidths(2, propsRef.current.assignments.length, 132);
      }

      const persist = () => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (active) {
          localStorage.setItem(
            storageKey(propsRef.current.classroomId),
            JSON.stringify(active.save()),
          );
        }
      };

      getContextRef.current = () => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active) return EMPTY_AI_CONTEXT;
        return {
          active_sheet: active.getActiveSheet().getSheetName(),
          sheets: active.getSheets().map((worksheet) => {
            const dataRange = worksheet.getDataRange();
            const source = dataRange.getRange();
            const rowCount = Math.min(source.endRow - source.startRow + 1, 100);
            const columnCount = Math.min(
              source.endColumn - source.startColumn + 1,
              50,
            );
            const range = worksheet.getRange(
              source.startRow,
              source.startColumn,
              rowCount,
              columnCount,
            );
            return {
              name: worksheet.getSheetName(),
              range: range.getA1Notation(),
              values: range.getValues() as Array<Array<WorkbookCellValue>>,
            };
          }),
        };
      };

      applyActionsRef.current = (actions) => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active)
          return { applied: 0, rejected: ["The spreadsheet is not ready."] };
        let applied = 0;
        const rejected: string[] = [];
        for (const action of actions.slice(0, 100)) {
          if (action.type === "set_grade") continue;
          if (action.type === "add_column") {
            const gradeSheet = active.getSheetByName("Gradebook");
            if (!gradeSheet) {
              rejected.push(`Could not add “${action.title}”: Gradebook is missing.`);
              continue;
            }
            const linkedAssignment = action.assignment_id
              ? propsRef.current.assignments.find(
                  (assignment) => assignment.id === action.assignment_id,
                )
              : null;
            let targetColumn: number;
            if (linkedAssignment) {
              targetColumn =
                propsRef.current.assignments.indexOf(linkedAssignment) + 2;
            } else {
              const firstCustomColumn = propsRef.current.assignments.length + 2;
              const headers = gradeSheet
                .getRange(0, 0, 1, gradeSheet.getMaxColumns())
                .getValues()[0];
              targetColumn = headers.findIndex(
                (value, index) => index >= firstCustomColumn && value == null,
              );
              if (targetColumn < 0) {
                const previousLast = gradeSheet.getMaxColumns() - 1;
                gradeSheet.insertColumnsAfter(previousLast, 10);
                targetColumn = previousLast + 1;
              }
            }
            const title = linkedAssignment
              ? `${linkedAssignment.title} / ${linkedAssignment.max_points}`
              : action.title.trim().slice(0, 80);
            gradeSheet
              .getRange(0, targetColumn)
              .setValue(title)
              .setBackgroundColor("#f0e7de")
              .setFontWeight("bold");
            gradeSheet.setColumnWidth(targetColumn, 140);
            for (const item of action.values ?? []) {
              const row = propsRef.current.roster.findIndex(
                (student) => student.id === item.student_id,
              );
              if (row >= 0 && !linkedAssignment) {
                gradeSheet
                  .getRange(row + 1, targetColumn)
                  .setValue(item.value === null ? { v: null } : item.value);
              }
            }
            applied += 1;
            continue;
          }

          const worksheet = active.getSheetByName(action.sheet);
          const location = columnIndexFromA1(action.cell);
          if (!worksheet || !location) {
            rejected.push(`Skipped invalid cell ${action.sheet}!${action.cell}.`);
            continue;
          }
          if (location.column >= worksheet.getMaxColumns()) {
            worksheet.insertColumnsAfter(
              worksheet.getMaxColumns() - 1,
              location.column - worksheet.getMaxColumns() + 1,
            );
          }
          if (action.sheet === "Gradebook") {
            const protectedColumns = propsRef.current.assignments.length + 2;
            const protectedRow = location.row <= propsRef.current.roster.length;
            if (protectedRow && location.column < protectedColumns) {
              rejected.push(
                `Skipped protected cell Gradebook!${action.cell}; use a reviewed grade action instead.`,
              );
              continue;
            }
          }
          worksheet
            .getRange(action.cell.toUpperCase())
            .setValue(action.value === null ? { v: null } : action.value);
          applied += 1;
        }
        persist();
        return { applied, rejected };
      };

      let timer: number | undefined;
      let hydrated = false;
      window.setTimeout(() => {
        hydrated = true;
      }, 350);
      const listener = univerAPI.addEvent(
        univerAPI.Event.CommandExecuted,
        () => {
          if (!hydrated) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            const active = univerAPI.getWorkbook(workbook.getId());
            if (!active) return;
            persist();
            const gradeSheet = active.getSheetByName("Gradebook");
            if (!gradeSheet) return;
            propsRef.current.roster.forEach((student, row) => {
              propsRef.current.assignments.forEach((assignment, column) => {
                if (!propsRef.current.submitted(student.id, assignment.id))
                  return;
                const raw = gradeSheet
                  .getRange(row + 1, column + 2)
                  .getValues()[0]?.[0];
                const value = raw == null ? "" : String(raw);
                if (
                  value !==
                  (propsRef.current.scores[
                    `${student.id}:${assignment.id}`
                  ] ?? "")
                ) {
                  propsRef.current.onScoreChange(student.id, assignment, value);
                }
              });
            });
          }, 650);
        },
      );
      return () => {
        window.clearTimeout(timer);
        listener.dispose();
        persist();
        getContextRef.current = () => EMPTY_AI_CONTEXT;
        applyActionsRef.current = () => ({
          applied: 0,
          rejected: ["The spreadsheet is still opening."],
        });
        univer.dispose();
      };
    }, [props.classroomId]);

    return <div className="univer-gradebook" ref={containerRef} />;
  },
);
