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
import { useTheme, type Assignment, type User } from "@cinder/ui";
import {
  assignmentForHeader,
  findGradebookAssignmentColumn,
  resolveGradebookCellTarget,
} from "./gradebookIntent";

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
      type: "update_assignment";
      assignment_id: string;
      title: string;
      max_points: number;
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
  showPreview: (actions: GradebookAction[]) => void;
  clearPreview: () => void;
  resetWorkbook: () => void;
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
  ) => Promise<boolean>;
};

const storageKey = (classroomId: string) =>
  `cinder.teacher.workbook.${classroomId}`;
const EMPTY_AI_CONTEXT: GradebookAiContext = {
  active_sheet: "Gradebook",
  sheets: [],
};

function createSheetUniver(container: HTMLDivElement, darkMode: boolean) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(sheetsEnUS) },
    darkMode,
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
  const previousCellData = sheet.cellData ?? {};
  const populatedColumns = new Set<number>();
  Object.values(previousCellData).forEach((rowData) => {
    Object.entries(rowData ?? {}).forEach(([column, cell]) => {
      const populatedCell = cell as { v?: unknown; f?: unknown };
      if (
        Number(column) >= 2 &&
        (String(populatedCell.v ?? "").trim() !== "" ||
          Boolean(populatedCell.f))
      ) {
        populatedColumns.add(Number(column));
      }
    });
  });
  const customColumns = [...populatedColumns]
    .map((column) => ({ column, cell: previousCellData[0]?.[column] }))
    .filter(
      ({ column, cell }) =>
        column >= 2 &&
        String(cell?.v ?? "").trim() !== "" &&
        !assignmentForHeader(cell?.v, props.assignments),
    )
    .sort((left, right) => left.column - right.column);
  const nextCellData: NonNullable<typeof sheet.cellData> = {};
  customColumns.forEach(({ column: sourceColumn }, customIndex) => {
    const targetColumn = props.assignments.length + 2 + customIndex;
    for (const [rowKey, rowData] of Object.entries(previousCellData)) {
      const cell = rowData?.[sourceColumn];
      if (cell === undefined) continue;
      const row = Number(rowKey);
      nextCellData[row] ??= {};
      nextCellData[row][targetColumn] = cell;
    }
  });
  sheet.cellData = nextCellData;
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

function cellValueMatches(
  expected: WorkbookCellValue,
  actual: WorkbookCellValue | undefined,
) {
  if (expected === null) return actual == null || actual === "";
  if (typeof expected === "number") return Number(actual) === expected;
  return actual === expected;
}

export const UniverGradebook = forwardRef<UniverGradebookHandle, Props>(
  function UniverGradebook(props, ref) {
    const { theme } = useTheme();
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
    const showPreviewRef = useRef<(actions: GradebookAction[]) => void>(
      () => undefined,
    );
    const clearPreviewRef = useRef<() => void>(() => undefined);
    const resetWorkbookRef = useRef<() => void>(() => undefined);
    const syncAuthoritativeRef = useRef<() => void>(() => undefined);
    const setDarkModeRef = useRef<(darkMode: boolean) => void>(() => undefined);
    propsRef.current = props;

    useImperativeHandle(
      ref,
      () => ({
        getAiContext: () => getContextRef.current(),
        showPreview: (actions) => showPreviewRef.current(actions),
        clearPreview: () => clearPreviewRef.current(),
        resetWorkbook: () => resetWorkbookRef.current(),
        applyActions: (actions) => applyActionsRef.current(actions),
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const { univer, univerAPI } = createSheetUniver(
        containerRef.current,
        theme !== "light",
      );
      setDarkModeRef.current = (darkMode) => univerAPI.toggleDarkMode(darkMode);
      const workbook = univerAPI.createWorkbook(workbookData(propsRef.current));
      const sheet = workbook.getSheetByName("Gradebook");
      sheet?.setColumnWidth(0, 190);
      sheet?.setColumnWidth(1, 140);
      sheet?.setRowHeight(0, 62);
      if (sheet && propsRef.current.assignments.length) {
        sheet.setColumnWidths(2, propsRef.current.assignments.length, 190);
        sheet
          .getRange(0, 0, 1, propsRef.current.assignments.length + 2)
          .setWrap(true)
          .setVerticalAlignment("middle");
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
      let persistTimer: number | undefined;
      let syncTimer: number | undefined;
      let hydrated = false;
      let synchronizing = false;
      let renderedRosterCount = propsRef.current.roster.length;
      let renderedAssignmentCount = propsRef.current.assignments.length;
      const gradeTimers = new Map<string, number>();
      const gradeVersions = new Map<string, number>();
      const gradeValues = new Map<string, string>();
      const persistedGradeValues = new Map<string, string>();

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

      const customColumnFor = (
        gradeSheet: NonNullable<typeof sheet>,
        title: string,
        create: boolean,
      ) => {
        const firstCustomColumn = propsRef.current.assignments.length + 2;
        const headers = gradeSheet
          .getRange(0, 0, 1, gradeSheet.getMaxColumns())
          .getValues()[0];
        const existing = headers.findIndex(
          (value, index) =>
            index >= firstCustomColumn &&
            String(value ?? "").trim().toLocaleLowerCase() ===
              title.trim().toLocaleLowerCase(),
        );
        if (existing >= 0) return existing;
        const blank = headers.findIndex(
          (value, index) => index >= firstCustomColumn && value == null,
        );
        if (blank >= 0 || !create) return blank;
        const previousLast = gradeSheet.getMaxColumns() - 1;
        gradeSheet.insertColumnsAfter(previousLast, 10);
        return previousLast + 1;
      };

      const previewed = new Map<
        string,
        { sheet: string; row: number; column: number; background: string }
      >();
      clearPreviewRef.current = () => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active) return;
        for (const cell of previewed.values()) {
          active
            .getSheetByName(cell.sheet)
            ?.getRange(cell.row, cell.column)
            .setBackgroundColor(cell.background || "#ffffff");
        }
        previewed.clear();
      };
      syncAuthoritativeRef.current = () => {
        const active = univerAPI.getWorkbook(workbook.getId());
        const gradeSheet = active?.getSheetByName("Gradebook");
        if (!active || !gradeSheet) return;
        synchronizing = true;
        clearPreviewRef.current();
        gradeTimers.forEach((timer) => window.clearTimeout(timer));
        gradeTimers.clear();

        const nextAssignmentCount = propsRef.current.assignments.length;
        if (nextAssignmentCount > renderedAssignmentCount) {
          gradeSheet.insertColumnsBefore(
            renderedAssignmentCount + 2,
            nextAssignmentCount - renderedAssignmentCount,
          );
        } else if (nextAssignmentCount < renderedAssignmentCount) {
          gradeSheet.deleteColumns(
            nextAssignmentCount + 2,
            renderedAssignmentCount - nextAssignmentCount,
          );
        }

        const rowsToClear = Math.max(
          renderedRosterCount,
          propsRef.current.roster.length,
        );
        gradeSheet
          .getRange(0, 0, rowsToClear + 1, nextAssignmentCount + 2)
          .clearContent();
        gradeSheet
          .getRange(0, 0)
          .setValue("Student")
          .setBackgroundColor("#f0e7de")
          .setFontWeight("bold");
        gradeSheet
          .getRange(0, 1)
          .setValue("Username")
          .setBackgroundColor("#f0e7de")
          .setFontWeight("bold");

        propsRef.current.assignments.forEach((assignment, column) => {
          gradeSheet
            .getRange(0, column + 2)
            .setValue(`${assignment.title} / ${assignment.max_points}`)
            .setBackgroundColor("#f0e7de")
            .setFontWeight("bold")
            .setWrap(true)
            .setVerticalAlignment("middle");
        });

        gradeValues.clear();
        persistedGradeValues.clear();
        propsRef.current.roster.forEach((student, row) => {
          gradeSheet.getRange(row + 1, 0).setValue(student.display_name);
          gradeSheet.getRange(row + 1, 1).setValue(student.username);
          propsRef.current.assignments.forEach((assignment, column) => {
            const key = `${student.id}:${assignment.id}`;
            const value = propsRef.current.submitted(student.id, assignment.id)
              ? (propsRef.current.scores[key] ?? "")
              : "—";
            gradeSheet
              .getRange(row + 1, column + 2)
              .setValue(
                value === ""
                  ? { v: null }
                  : Number.isFinite(Number(value))
                    ? Number(value)
                    : value,
              );
            gradeValues.set(key, value === "—" ? "" : value);
            persistedGradeValues.set(key, value === "—" ? "" : value);
          });
        });
        renderedRosterCount = propsRef.current.roster.length;
        renderedAssignmentCount = nextAssignmentCount;
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(() => {
          synchronizing = false;
          persist();
        }, 50);
      };
      resetWorkbookRef.current = () => {
        clearPreviewRef.current();
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active) return;
        synchronizing = true;
        for (const worksheet of active.getSheets()) {
          if (worksheet.getSheetName() !== "Gradebook") {
            active.deleteSheet(worksheet);
          }
        }
        active.getSheetByName("Gradebook")?.clear();
        localStorage.removeItem(storageKey(propsRef.current.classroomId));
        syncAuthoritativeRef.current();
      };
      showPreviewRef.current = (actions) => {
        clearPreviewRef.current();
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active) return;
        const highlight = (sheetName: string, row: number, column: number) => {
          const worksheet = active.getSheetByName(sheetName);
          if (
            !worksheet ||
            row < 0 ||
            column < 0 ||
            row >= worksheet.getMaxRows() ||
            column >= worksheet.getMaxColumns()
          )
            return;
          const key = `${sheetName}:${row}:${column}`;
          const range = worksheet.getRange(row, column);
          if (!previewed.has(key)) {
            previewed.set(key, {
              sheet: sheetName,
              row,
              column,
              background: range.getBackground(),
            });
          }
          range.setBackgroundColor("#ffe0cc");
        };

        const gradeSheet = active.getSheetByName("Gradebook");
        for (const action of actions.slice(0, 100)) {
          if (action.type === "set_grade") {
            const row = propsRef.current.roster.findIndex(
              (student) => student.id === action.student_id,
            );
            const column = propsRef.current.assignments.findIndex(
              (assignment) => assignment.id === action.assignment_id,
            );
            if (row >= 0 && column >= 0) highlight("Gradebook", row + 1, column + 2);
            continue;
          }
          if (action.type === "update_assignment") {
            const assignment = propsRef.current.assignments.find(
              (item) => item.id === action.assignment_id,
            );
            if (assignment) {
              const column = findGradebookAssignmentColumn(
                assignment,
                propsRef.current.assignments,
                getContextRef.current(),
              );
              highlight("Gradebook", 0, column);
            }
            continue;
          }
          if (action.type === "add_column" && gradeSheet) {
            const column = customColumnFor(gradeSheet, action.title, false);
            if (column >= 0) {
              highlight("Gradebook", 0, column);
              for (const value of action.values ?? []) {
                const row = propsRef.current.roster.findIndex(
                  (student) => student.id === value.student_id,
                );
                if (row >= 0) highlight("Gradebook", row + 1, column);
              }
            }
            continue;
          }
          if (action.type === "set_cell") {
            const location = columnIndexFromA1(action.cell);
            if (location) highlight(action.sheet, location.row, location.column);
          }
        }
      };

      applyActionsRef.current = (actions) => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active)
          return { applied: 0, rejected: ["The spreadsheet is not ready."] };
        let applied = 0;
        const rejected: string[] = [];
        for (const action of actions.slice(0, 100)) {
          if (
            action.type === "set_grade" ||
            action.type === "update_assignment"
          )
            continue;
          try {
            if (action.type === "add_column") {
              const gradeSheet = active.getSheetByName("Gradebook");
              if (!gradeSheet) {
                rejected.push(
                  `Could not add “${action.title}”: Gradebook is missing.`,
                );
                continue;
              }
              const targetColumn = customColumnFor(
                gradeSheet,
                action.title,
                true,
              );
              const title = action.title.trim().slice(0, 80);
              gradeSheet
                .getRange(0, targetColumn)
                .setValue(title)
                .setBackgroundColor("#f0e7de")
                .setFontWeight("bold")
                .setWrap(true)
                .setVerticalAlignment("middle");
              gradeSheet.setColumnWidth(targetColumn, 190);
              const writtenTitle = gradeSheet
                .getRange(0, targetColumn)
                .getValues()[0]?.[0];
              if (String(writtenTitle ?? "") !== title) {
                throw new Error(`the “${title}” header was not written`);
              }
              let failedValues = 0;
              for (const item of action.values ?? []) {
                const row = propsRef.current.roster.findIndex(
                  (student) => student.id === item.student_id,
                );
                if (row < 0) {
                  failedValues += 1;
                  continue;
                }
                const range = gradeSheet.getRange(row + 1, targetColumn);
                range.setValue(item.value === null ? { v: null } : item.value);
                const actual = range.getValues()[0]?.[0] as
                  | WorkbookCellValue
                  | undefined;
                if (!cellValueMatches(item.value, actual)) failedValues += 1;
              }
              if (failedValues) {
                rejected.push(
                  `Added “${title}”, but ${failedValues} value(s) could not be verified.`,
                );
              }
              applied += 1;
              continue;
            }

            const worksheet = active.getSheetByName(action.sheet);
            const location = columnIndexFromA1(action.cell);
            if (!worksheet || !location) {
              rejected.push(
                `Skipped invalid cell ${action.sheet}!${action.cell}.`,
              );
              continue;
            }
            if (location.column >= worksheet.getMaxColumns()) {
              worksheet.insertColumnsAfter(
                worksheet.getMaxColumns() - 1,
                location.column - worksheet.getMaxColumns() + 1,
              );
            }
            if (location.row >= worksheet.getMaxRows()) {
              worksheet.insertRowsAfter(
                worksheet.getMaxRows() - 1,
                location.row - worksheet.getMaxRows() + 1,
              );
            }
            if (action.sheet === "Gradebook") {
              const target = resolveGradebookCellTarget(
                action.cell,
                propsRef.current.roster,
                propsRef.current.assignments,
                getContextRef.current(),
              );
              if (!target || target.kind !== "custom") {
                rejected.push(
                  `Skipped protected Gradebook cell ${action.cell}; assignment headings and grades require their audited actions.`,
                );
                continue;
              }
            }
            const target = worksheet.getRange(action.cell.toUpperCase());
            target.setValue(
              action.value === null ? { v: null } : action.value,
            );
            const verified =
              typeof action.value === "string" &&
              action.value.startsWith("=")
                ? target.getFormula() === action.value
                : cellValueMatches(
                    action.value,
                    target.getValues()[0]?.[0] as
                      | WorkbookCellValue
                      | undefined,
                  );
            if (!verified) {
              throw new Error(
                `${action.sheet}!${action.cell} did not contain the requested value`,
              );
            }
            applied += 1;
          } catch (failure) {
            rejected.push(
              failure instanceof Error
                ? `Could not apply ${action.type}: ${failure.message}.`
                : `Could not apply ${action.type}.`,
            );
          }
        }
        persist();
        return { applied, rejected };
      };

      window.setTimeout(() => {
        hydrated = true;
      }, 350);
      const persistListener = univerAPI.addEvent(
        univerAPI.Event.CommandExecuted,
        () => {
          if (!hydrated || synchronizing) return;
          window.clearTimeout(persistTimer);
          persistTimer = window.setTimeout(persist, 450);
        },
      );
      const valueListener = univerAPI.addEvent(
        univerAPI.Event.SheetValueChanged,
        (event) => {
          if (!hydrated || synchronizing) return;
          const activeGradeSheet = univerAPI
            .getWorkbook(workbook.getId())
            ?.getSheetByName("Gradebook");
          if (!activeGradeSheet) return;
          for (const affected of event.effectedRanges) {
            if (affected.getSheetName() !== "Gradebook") continue;
            const range = affected.getRange();
            const firstRow = Math.max(1, range.startRow);
            const lastRow = Math.min(propsRef.current.roster.length, range.endRow);
            const firstColumn = Math.max(2, range.startColumn);
            const lastColumn = Math.min(
              propsRef.current.assignments.length + 1,
              range.endColumn,
            );
            for (let row = firstRow; row <= lastRow; row += 1) {
              for (let column = firstColumn; column <= lastColumn; column += 1) {
                const student = propsRef.current.roster[row - 1];
                const assignment = propsRef.current.assignments[column - 2];
                if (!student || !assignment) continue;
                if (!propsRef.current.submitted(student.id, assignment.id)) continue;
                const key = `${student.id}:${assignment.id}`;
                const raw = activeGradeSheet.getRange(row, column).getValues()[0]?.[0];
                const value = raw == null ? "" : String(raw).trim();
                const previous = gradeValues.get(key) ?? "";
                if (value === previous) continue;
                gradeValues.set(key, value);
                const version = (gradeVersions.get(key) ?? 0) + 1;
                gradeVersions.set(key, version);
                window.clearTimeout(gradeTimers.get(key));
                gradeTimers.set(
                  key,
                  window.setTimeout(() => {
                    void propsRef.current
                      .onScoreChange(student.id, assignment, value)
                      .then((saved) => {
                        if (saved) {
                          persistedGradeValues.set(key, value);
                          return;
                        }
                        if (gradeVersions.get(key) !== version) return;
                        const rollback = persistedGradeValues.get(key) ?? "";
                        gradeValues.set(key, rollback);
                        activeGradeSheet
                          .getRange(row, column)
                          .setValue(
                            rollback === ""
                              ? { v: null }
                              : Number.isFinite(Number(rollback))
                                ? Number(rollback)
                                : rollback,
                          );
                      });
                  }, 500),
                );
              }
            }
          }
        },
      );
      return () => {
        window.clearTimeout(persistTimer);
        window.clearTimeout(syncTimer);
        gradeTimers.forEach((timer) => window.clearTimeout(timer));
        clearPreviewRef.current();
        persistListener.dispose();
        valueListener.dispose();
        persist();
        getContextRef.current = () => EMPTY_AI_CONTEXT;
        showPreviewRef.current = () => undefined;
        clearPreviewRef.current = () => undefined;
        resetWorkbookRef.current = () => undefined;
        syncAuthoritativeRef.current = () => undefined;
        setDarkModeRef.current = () => undefined;
        applyActionsRef.current = () => ({
          applied: 0,
          rejected: ["The spreadsheet is still opening."],
        });
        univer.dispose();
      };
    }, [props.classroomId]);

    useEffect(() => {
      setDarkModeRef.current(theme !== "light");
    }, [theme]);

    useEffect(() => {
      syncAuthoritativeRef.current();
    }, [props.assignments, props.roster, props.scores]);

    return <div className="univer-gradebook" ref={containerRef} />;
  },
);
