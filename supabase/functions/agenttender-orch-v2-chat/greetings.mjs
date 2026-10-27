// Full-message matches only: mixed questions always continue to evidence retrieval.
export function casualAnswer(value) {
 const q=String(value).toLowerCase().replace(/[!?.،,]/g,' ').replace(/\s+/g,' ').trim();
 if (/^(?:(?:hi|hello|hey) )?how (?:are you|r u)(?: doing)?(?: today)?$/.test(q)) return "I’m doing well! How can I help you today?";
 if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)(?: there| bot)?$/.test(q)) return "Hi! How can I help you with this tender?";
 if (/^(?:thanks|thank you|thanks a lot|thank you very much)$/.test(q)) return "You’re welcome!";
 return null;
}
