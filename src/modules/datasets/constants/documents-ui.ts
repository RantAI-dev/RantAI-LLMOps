import { textUi } from "@/lib/text-ui";

export const documentsUi = textUi;

export type DocumentsFilters = {
  search: string;
  knowledgeBase: string | "all";
  documentStatus: "all" | "Pending" | "Processing" | "Indexed" | "Failed";
  indexStatus: "all" | "Not Indexed" | "Indexing" | "Ready" | "Stale" | "Failed";
  sort: "newest" | "oldest" | "name" | "size";
};

export const defaultDocumentsFilters: DocumentsFilters = {
  search: "",
  knowledgeBase: "all",
  documentStatus: "all",
  indexStatus: "all",
  sort: "newest",
};
