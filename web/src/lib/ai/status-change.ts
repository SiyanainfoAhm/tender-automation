import {STATUS_DISPLAY_LABELS,type TenderStatus} from '@/lib/tender-status';

export function chatStatusLabel(status:TenderStatus) {
 if(status==='GO')return 'Will Bid (GO)';
 if(status==='CONDITIONAL_GO')return 'May Bid (Conditional GO)';
 if(status==='NO_GO')return 'No Bid (No GO)';
 if(status==='DELETE')return 'Delete status';
 return STATUS_DISPLAY_LABELS[status];
}
// Only a user's explicit command opens a form. Analysis and recommendations
// continue through the read-only answer engine. No command executes a write.
export function isStatusChangeRequest(message:string) {
 const text=message.trim().replace(/^(?:(?:please|can you|can u|could you|would you|can i|i want to|i would like to|let['’]s)\s+)+/i,'');
 return /^(?:change|update|set|switch|move|mark)\b/i.test(text)&&/\b(?:status|tenders?|it|this|go|conditionalgo|may\s*bid|will\s*bid|no\s*bid|verify|submitted|won|lost)\b/i.test(text);
}
export function tenderIdFromCommand(message:string) {
 return message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
}
export type StatusTenderOption={id:string;title:string};
export type ChatStatusState={
 id:string;title:string;current_status:TenderStatus|null;display_status:TenderStatus|null;tender_value:number|null;
 options:Array<{value:TenderStatus;label:string;allowed:boolean}>;
};
