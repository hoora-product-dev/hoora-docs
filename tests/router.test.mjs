import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishedRoute,routeUrl} from '../public/router.js';
import {publishedPath} from '../server/links.js';

test('published releases use version and application URLs',()=>{
 const project={id:'app-1',slug:'customer-app'};
 const release={kind:'release',slug:'old-shared-link',version:'v5.12.0',project_id:project.id};
 assert.equal(routeUrl(publishedRoute(release,[project])),'/release-notes/5.12.0/customer-app');
 assert.equal(routeUrl(publishedRoute({...release,project_id:null,release_snapshot:{project:'Customer App'}},[])),'/release-notes/5.12.0/customer-app');
 assert.equal(routeUrl(publishedRoute({...release,release_snapshot:{project:'Customer App'}},[{id:'app-1',slug:'renamed-app'}])),'/release-notes/5.12.0/customer-app');
 assert.equal(routeUrl(publishedRoute({kind:'sop',slug:'operations-guide'},[])),'/docs/operations-guide');
 assert.equal(publishedPath({...release,release_snapshot:{project:'Customer App'}}),'/release-notes/5.12.0/customer-app');
});
