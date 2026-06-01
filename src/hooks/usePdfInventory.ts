import { useReducer, useEffect, useCallback } from "react";
import { StagedPdf } from "../types/pdf";
import { createStagedPdfFromUrl } from "../utils/createStagedPdfFromUrl";

export interface InventoryFilters {
  status: string;
  grade: string;
  subject: string;
}

export interface PdfInventoryState {
  foundUrls: string[];
  stagedPdfs: StagedPdf[];
  selectedPdfUrls: string[];
  filters: InventoryFilters;
  activeJobId: string | null;
}

type PdfInventoryAction =
  | { type: "ADD_FOUND_URLS"; urls: string[] }
  | { type: "STAGE_URLS"; urls: string[]; autoSelect?: boolean }
  | { type: "UPDATE_PDF"; url: string; updates: Partial<StagedPdf> }
  | { type: "UPDATE_MANY_PDFS"; updates: { url: string; updates: Partial<StagedPdf> }[] }
  | { type: "SELECT_URLS"; urls: string[] | ((prev: string[]) => string[]) }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_FILTERS"; filters: Partial<InventoryFilters> }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_ACTIVE_JOB_ID"; jobId: string | null }
  | { type: "RESET_WORKSPACE" }
  | { type: "SET_STAGED_PDFS"; pdfs: StagedPdf[] }
  | { type: "SET_STAGED_PDFS_FUNCTIONAL"; fn: (prev: StagedPdf[]) => StagedPdf[] };

const initialFilters: InventoryFilters = {
  status: "all",
  grade: "all",
  subject: "all",
};

const initialState: PdfInventoryState = {
  foundUrls: [],
  stagedPdfs: [],
  selectedPdfUrls: [],
  filters: initialFilters,
  activeJobId: null,
};

function pdfInventoryReducer(state: PdfInventoryState, action: PdfInventoryAction): PdfInventoryState {
  switch (action.type) {
    case "ADD_FOUND_URLS": {
      const merged = Array.from(new Set([...state.foundUrls, ...action.urls]));
      return { ...state, foundUrls: merged };
    }
    case "STAGE_URLS": {
      const newUrls = action.urls.filter(url => !state.stagedPdfs.some(p => p.url === url));
      const newItems = newUrls.map(createStagedPdfFromUrl);
      const updatedStaged = [...state.stagedPdfs, ...newItems];
      let updatedSelected = state.selectedPdfUrls;
      if (action.autoSelect) {
        updatedSelected = Array.from(new Set([...state.selectedPdfUrls, ...action.urls]));
      }
      return {
        ...state,
        stagedPdfs: updatedStaged,
        selectedPdfUrls: updatedSelected,
      };
    }
    case "UPDATE_PDF": {
      return {
        ...state,
        stagedPdfs: state.stagedPdfs.map(pdf =>
          pdf.url === action.url ? { ...pdf, ...action.updates } : pdf
        ),
      };
    }
    case "UPDATE_MANY_PDFS": {
      const updateMap = new Map(action.updates.map(u => [u.url, u.updates]));
      return {
        ...state,
        stagedPdfs: state.stagedPdfs.map(pdf => {
          const up = updateMap.get(pdf.url);
          return up ? { ...pdf, ...up } : pdf;
        }),
      };
    }
    case "SELECT_URLS": {
      let nextSelected: string[];
      if (typeof action.urls === "function") {
        nextSelected = action.urls(state.selectedPdfUrls);
      } else {
        nextSelected = action.urls;
      }
      const stagedSet = new Set(state.stagedPdfs.map(p => p.url));
      nextSelected = nextSelected.filter(url => stagedSet.has(url));
      return {
        ...state,
        selectedPdfUrls: nextSelected,
      };
    }
    case "CLEAR_SELECTION": {
      return {
        ...state,
        selectedPdfUrls: [],
      };
    }
    case "SET_FILTERS": {
      return {
        ...state,
        filters: { ...state.filters, ...action.filters },
      };
    }
    case "CLEAR_FILTERS": {
      return {
        ...state,
        filters: { ...initialFilters },
      };
    }
    case "SET_ACTIVE_JOB_ID": {
      return {
        ...state,
        activeJobId: action.jobId,
      };
    }
    case "SET_STAGED_PDFS": {
      return {
        ...state,
        stagedPdfs: action.pdfs,
      };
    }
    case "SET_STAGED_PDFS_FUNCTIONAL": {
      return {
        ...state,
        stagedPdfs: action.fn(state.stagedPdfs),
      };
    }
    case "RESET_WORKSPACE": {
      return {
        ...state,
        foundUrls: [],
        stagedPdfs: [],
        selectedPdfUrls: [],
        filters: { ...initialFilters },
        activeJobId: null,
      };
    }
    default:
      return state;
  }
}

export function usePdfInventory() {
  const [state, dispatch] = useReducer(pdfInventoryReducer, initialState, () => {
    try {
      const cached = localStorage.getItem("scarpe_staged_pdfs");
      const initialStaged = cached ? JSON.parse(cached) : [];
      return {
        ...initialState,
        stagedPdfs: initialStaged,
      };
    } catch {
      return initialState;
    }
  });

  // Keep localStorage in sync with stagedPdfs
  useEffect(() => {
    if (state.stagedPdfs.length > 0) {
      localStorage.setItem("scarpe_staged_pdfs", JSON.stringify(state.stagedPdfs));
    } else {
      localStorage.removeItem("scarpe_staged_pdfs");
    }
  }, [state.stagedPdfs]);

  const addFoundUrls = useCallback((urls: string[]) => {
    dispatch({ type: "ADD_FOUND_URLS", urls });
  }, []);

  const stageUrls = useCallback((urls: string[], autoSelect?: boolean) => {
    dispatch({ type: "STAGE_URLS", urls, autoSelect });
  }, []);

  const updatePdf = useCallback((url: string, updates: Partial<StagedPdf>) => {
    dispatch({ type: "UPDATE_PDF", url, updates });
  }, []);

  const updateManyPdfs = useCallback((updates: { url: string; updates: Partial<StagedPdf> }[]) => {
    dispatch({ type: "UPDATE_MANY_PDFS", updates });
  }, []);

  const selectUrls = useCallback((urls: string[] | ((prev: string[]) => string[])) => {
    dispatch({ type: "SELECT_URLS", urls });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: "CLEAR_SELECTION" });
  }, []);

  const setFilters = useCallback((filters: Partial<InventoryFilters>) => {
    dispatch({ type: "SET_FILTERS", filters });
  }, []);

  const clearFilters = useCallback(() => {
    dispatch({ type: "CLEAR_FILTERS" });
  }, []);

  const setActiveJobId = useCallback((jobId: string | null) => {
    dispatch({ type: "SET_ACTIVE_JOB_ID", jobId });
  }, []);

  const resetWorkspace = useCallback(() => {
    dispatch({ type: "RESET_WORKSPACE" });
    localStorage.removeItem("scarpe_staged_pdfs");
  }, []);

  const setStagedPdfs = useCallback((pdfs: StagedPdf[] | ((prev: StagedPdf[]) => StagedPdf[])) => {
    if (typeof pdfs === "function") {
      dispatch({ type: "SET_STAGED_PDFS_FUNCTIONAL", fn: pdfs });
    } else {
      dispatch({ type: "SET_STAGED_PDFS", pdfs });
    }
  }, []);

  return {
    foundUrls: state.foundUrls,
    stagedPdfs: state.stagedPdfs,
    selectedPdfUrls: state.selectedPdfUrls,
    filters: state.filters,
    activeJobId: state.activeJobId,
    addFoundUrls,
    stageUrls,
    updatePdf,
    updateManyPdfs,
    selectUrls,
    clearSelection,
    setFilters,
    clearFilters,
    setActiveJobId,
    resetWorkspace,
    setStagedPdfs,
  };
}
