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
import { createGradeCells } from "./gradebookCells";
import { assignmentForHeader, formatAssignmentHeader, NOT_HANDED_IN } from "./gradebookHeaders";

export type UniverGradebookHandle = {
  resetWorkbook: () => void;
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
  /** Called when a typed mark is undone because the work was not handed in. */
  onRefused: (message: string) => void;
};

const storageKey = (classroomId: string) =>
  `cinder.teacher.workbook.${classroomId}`;

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
      v: formatAssignmentHeader(assignment),
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
        : NOT_HANDED_IN;
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

export const UniverGradebook = forwardRef<UniverGradebookHandle, Props>(
  function UniverGradebook(props, ref) {
    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef(props);
    const resetWorkbookRef = useRef<() => void>(() => undefined);
    const syncAuthoritativeRef = useRef<() => void>(() => undefined);
    const setDarkModeRef = useRef<(darkMode: boolean) => void>(() => undefined);
    propsRef.current = props;

    useImperativeHandle(
      ref,
      () => ({
        resetWorkbook: () => resetWorkbookRef.current(),
      }),
      [],
    );

    useEffect(() => {
      const host = containerRef.current;
      if (!host) return;
      // Each instance gets its own element, so a new sheet never mounts into
      // the DOM of one that is still being torn down.
      const mount = document.createElement("div");
      mount.className = "univer-mount";
      host.appendChild(mount);
      const { univer, univerAPI } = createSheetUniver(
        mount,
        theme === "dark",
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
      // Saves waiting for their timer, run at once if the Gradebook closes first.
      const gradeSaves = new Map<string, () => void>();
      const cells = createGradeCells();
      const cellValue = (value: string) =>
        value === "" ? { v: null } : Number.isFinite(Number(value)) ? Number(value) : value;

      syncAuthoritativeRef.current = () => {
        const active = univerAPI.getWorkbook(workbook.getId());
        const gradeSheet = active?.getSheetByName("Gradebook");
        if (!active || !gradeSheet) return;
        synchronizing = true;

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
            .setValue(formatAssignmentHeader(assignment))
            .setBackgroundColor("#f0e7de")
            .setFontWeight("bold")
            .setWrap(true)
            .setVerticalAlignment("middle");
        });

        propsRef.current.roster.forEach((student, row) => {
          gradeSheet.getRange(row + 1, 0).setValue(student.display_name);
          gradeSheet.getRange(row + 1, 1).setValue(student.username);
          propsRef.current.assignments.forEach((assignment, column) => {
            const key = `${student.id}:${assignment.id}`;
            const submitted = propsRef.current.submitted(student.id, assignment.id);
            // Recorded before writing, so the value listener recognises the Gradebook's own write;
            // a mark the teacher typed that is still waiting to be saved stays on screen.
            const shown = cells.fromHost(key, submitted ? (propsRef.current.scores[key] ?? "") : "");
            gradeSheet.getRange(row + 1, column + 2).setValue(cellValue(submitted ? shown : NOT_HANDED_IN));
          });
        });
        renderedRosterCount = propsRef.current.roster.length;
        renderedAssignmentCount = nextAssignmentCount;
        // Edits made from here on are judged by value, so none is ignored while the sheet settles.
        synchronizing = false;
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(persist, 50);
      };
      resetWorkbookRef.current = () => {
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
                const raw = activeGradeSheet.getRange(row, column).getValues()[0]?.[0];
                if (!propsRef.current.submitted(student.id, assignment.id)) {
                  // There is nothing to mark, so put the marker back rather than keep a mark that is never saved.
                  if (String(raw ?? "").trim() === NOT_HANDED_IN) continue;
                  window.setTimeout(() => activeGradeSheet.getRange(row, column).setValue(NOT_HANDED_IN), 0);
                  propsRef.current.onRefused(`${student.display_name} has not handed in ${assignment.title}, so there is nothing to mark yet.`);
                  continue;
                }
                const key = `${student.id}:${assignment.id}`;
                const mark = cells.edited(key, raw);
                if (mark === null) continue;
                // Bound now: the save belongs to the classroom and work shown when it was typed.
                const save = propsRef.current.onScoreChange;
                const run = () => {
                  gradeTimers.delete(key);
                  gradeSaves.delete(key);
                  void save(student.id, assignment, mark)
                    .catch(() => false)
                    .then((saved) => {
                      const back = cells.settled(key, mark, saved);
                      if (back === null) return;
                      try {
                        // Columns and rows may have moved since, so find the cell again.
                        const sheet = univerAPI.getWorkbook(workbook.getId())?.getSheetByName("Gradebook");
                        const studentRow = propsRef.current.roster.findIndex((item) => item.id === student.id);
                        const workColumn = propsRef.current.assignments.findIndex((item) => item.id === assignment.id);
                        if (sheet && studentRow >= 0 && workColumn >= 0) sheet.getRange(studentRow + 1, workColumn + 2).setValue(cellValue(back));
                      } catch {
                        // The Gradebook has closed; the next one loads the Host's marks.
                      }
                    });
                };
                window.clearTimeout(gradeTimers.get(key));
                gradeSaves.set(key, run);
                gradeTimers.set(key, window.setTimeout(run, 500));
              }
            }
          }
        },
      );
      return () => {
        window.clearTimeout(persistTimer);
        window.clearTimeout(syncTimer);
        gradeTimers.forEach((timer) => window.clearTimeout(timer));
        // A mark typed just before leaving the Gradebook is still saved.
        [...gradeSaves.values()].forEach((run) => run());
        persistListener.dispose();
        valueListener.dispose();
        persist();
        resetWorkbookRef.current = () => undefined;
        syncAuthoritativeRef.current = () => undefined;
        setDarkModeRef.current = () => undefined;
        // Univer unmounts its own React root. Doing that inside React's commit
        // ("synchronously unmount a root while rendering") left the next
        // instance blank, so it is deferred until React has finished.
        window.setTimeout(() => {
          univer.dispose();
          mount.remove();
        }, 0);
      };
    }, [props.classroomId]);

    useEffect(() => {
      setDarkModeRef.current(theme === "dark");
    }, [theme]);

    useEffect(() => {
      syncAuthoritativeRef.current();
    }, [props.assignments, props.roster, props.scores]);

    return <div className="univer-gradebook" ref={containerRef} />;
  },
);
