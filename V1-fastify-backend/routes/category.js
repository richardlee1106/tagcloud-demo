import { getCategoryTreeFromDB } from '../services/catalog.js';

export default async function categoryRoutes(fastify, options) {
  fastify.get('/tree', async (request, reply) => {
    try {
      const tree = await getCategoryTreeFromDB();
      return tree;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to load categories', details: err.message });
    }
  });

  fastify.get('/flat', async (request, reply) => {
    try {
      const tree = await getCategoryTreeFromDB();
      
      const flat = [];
      const traverse = (nodes) => {
        nodes.forEach(node => {
          if (node.children) {
            traverse(node.children);
          } else {
            flat.push(node.value);
          }
        });
      };
      traverse(tree);
      return flat;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to load flat categories' });
    }
  });
}
