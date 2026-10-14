import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('@/pages/IndexPage.vue') },
      {
        path: 'notes',
        name: 'notes',
        component: () => import('@/pages/NotesPage.vue')
      },
      {
        path: 'notes/:storageId/document/:id',
        name: 'note-document',
        component: () => import('@/pages/NotesPage.vue')
      },
      { path: 'reviews', component: () => import('@/pages/ReviewsPage.vue') },
      {
        path: 'reviews/:id',
        component: () => import('@/pages/ReviewDetailPage.vue')
      }
    ]
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('@/pages/ErrorNotFound.vue')
  }
]

export default routes
