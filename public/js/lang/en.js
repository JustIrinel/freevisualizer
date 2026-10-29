// English dictionary: Romanian UI text → English. One file per area of the app.
import ui from './en-ui.js';
import dialogs from './en-dialogs.js';
import app from './en-app.js';
import data from './en-data.js';
import gobo from './en-gobo.js';
import props from './en-props.js';
import groups from './en-groups.js';

export default { ...data, ...app, ...dialogs, ...ui, ...gobo, ...props, ...groups };
