const httpErrors = require("http-errors");
const mongoose = require("mongoose");
require("datejs");

const {
  getPostsSchema,
  getPostByIdSchema,
  createPostSchema,
  deleteCommentSchema,
  deletePostSchema,
  likeUnlikeCommentSchema,
  likeUnlikePostSchema,
  updateCommentSchema,
  updatePostSchema,
  addCommentSchema,
} = require("./schema/posts");

/*
 * /api/posts
 */
async function routes(app) {
  const { mongo } = app;
  const Comment = mongo.model("Comment");
  const Post = mongo.model("Post");
  const User = mongo.model("User");

  // /posts

  app.get("/", { schema: getPostsSchema }, async (req) => {
    // TODO: get userId from jwt
    // userId = ?
    // user = User.findById(userId);
    var user = await User.findById("5ea6900c0e0419d4cb123611");

    // TODO: add filters
    // TODO: add pagination
    return await Post.aggregate([
      {
        $geoNear: {
          distanceField: "distance",
          key: "author.location.coords",
          near: {
            $geometry: { type: "Point", coordinates: user.location.coords },
          },
          // query: { << add filters here >> }
        },
      },
      {
        $lookup: {
          as: "comments",
          foreignField: "postId",
          from: "comments",
          localField: "_id",
        },
      },
      {
        $project: {
          _id: true,
          authorName: "author.authorName",
          authorType: "author.authorType",
          commentsCount: {
            $size: "$comments",
          },
          content: true,
          distance: true,
          likesCount: {
            $size: "$likes",
          },
          title: true,
        },
      },
    ]);
  });

  app.post(
    "/",
    {
      // preValidation: [app.authenticate],
      schema: createPostSchema,
    },
    async (req, reply) => {
      // TODO: get userId from jwt
      // userId = ?
      // user = User.findById(userId);
      user = await User.findById("5ea6900c0e0419d4cb123611");
      if (user === null) return new httpErrors.Unauthorized();

      var postProps = req.body;

      // Creates embedded author document
      postProps.author = {
        authorId: user.id,
        authorName: user.firstName + " " + user.lastName,
        authorType: user.type,
        location: user.location,
      };

      // ExpireAt needs to calculate the date
      var expireAt = null;
      switch (postProps.expireAt) {
        case "day":
          postProps.expireAt = (1).days().fromNow();
          break;
        case "week":
          postProps.expireAt = (7).days().fromNow();
          break;
        case "month":
          postProps.expireAt = (1).months().fromNow();
          break;
      }

      // Initial empty likes array
      postProps.likes = [];

      var post = new Post(postProps);
      if (post.save()) {
        reply.code(201);
        return post;
      } else {
        return reply.send(new httpErrors.BadRequest());
      }
    },
  );

  // // /posts/postId

  app.get(
    "/:postId",
    {
      // preValidation: [app.authenticate],
      schema: getPostByIdSchema,
    },
    async (req, reply) => {
      // TODO: add pagination
      const { postId } = req.params;
      const post = await Post.findById(postId);
      if (post === null) {
        return reply.send(new httpErrors.NotFound());
      }
      var commentQuery = await Comment.aggregate([
        {
          $match: {
            parentId: null,
            postId: mongoose.Types.ObjectId(postId),
          },
        },
        {
          $lookup: {
            as: "children",
            foreignField: "parentId",
            from: "comments",
            localField: "_id",
          },
        },
        {
          $addFields: {
            childCount: {
              $size: { $ifNull: ["$children", []] },
            },
          },
        },
        {
          $group: {
            _id: null,
            comments: { $push: "$$ROOT" },
            numComments: { $sum: { $add: ["$childCount", 1] } },
          },
        },
      ]);

      commentQuery = commentQuery[0];
      if (commentQuery == null) commentQuery = { comments: [], numComments: 0 };

      return {
        commentCount: commentQuery.numComments,
        comments: commentQuery.comments,
        post: post,
      };
    },
  );

  app.delete(
    "/:postId",
    {
      // preValidation: [app.authenticate],
      schema: deletePostSchema,
    },
    async (req) => {
      const { postId } = req.params;
      // TODO: get userId from jwt
      // userId = ?
      // user = User.findById(userId);
      var user = await User.findById("5ea6900c0e0419d4cb123611");
      if (user === null) return new httpErrors.Unauthorized();

      var deletedPost = await Post.findById(postId);
      if (!deletedPost) {
        return new httpErrors.NotFound();
      } else if (deletedPost.author.authorId != user.id) {
        return new httpErrors.Forbidden();
      } else {
        deletedPost = await deletedPost.delete();
      }

      const {
        deletedCount: deletedCommentsCount,
        ok,
      } = await Comment.deleteMany({ postId });
      if (ok !== 1) {
        app.log.error("failed removing comments for deleted post", { postId });
      }
      return { deletedCommentsCount, deletedPost, success: true };
    },
  );

  app.patch(
    "/:postId",
    {
      // preValidation: [app.authenticate],
      schema: updatePostSchema,
    },
    async (req, reply) => {
      // TODO: get userId from jwt
      // userId = ?
      // user = User.findById(userId);
      var user = await User.findById("5ea6900c0e0419d4cb123611");
      if (user === null) return new httpErrors.Unauthorized();

      const post = await Post.findById(req.params.postId);
      if (!post) return new httpErrors.NotFound();
      else if (post.author.authorId != user.id)
        return new httpErrors.Forbidden();
      var body = req.body;

      // ExpireAt needs to calculate the date
      if ("expireAt" in body) {
        switch (body.expireAt) {
          case "day":
            body.expireAt = (1).days().fromNow();
            break;
          case "week":
            body.expireAt = (7).days().fromNow();
            break;
          case "month":
            body.expireAt = (1).months().fromNow();
            break;
        }
      }

      return Object.assign(post, body).save();
    },
  );

  // app.post(
  //   "/:postId/comments",
  //   { preValidation: [app.authenticate], schema: addCommentSchema },
  //   async (req) => {
  //     const { body, params } = req;
  //     const { parentId } = body;
  //     const { postId } = params;
  //     // todo: get user id from JWT
  //     //  check if user is authorized to comment (depending on visibility for that post)
  //     if (parentId) {
  //       const parentPost = await Post.findById(parentId);
  //       if (!parentPost || parentPost.postId !== postId) {
  //         return new httpErrors.BadRequest();
  //       }
  //     }
  //     const commentProps = {
  //       ...body,
  //       authorId: "", // req.user.id
  //       postId,
  //     };
  //     return new Comment(commentProps).save();
  //   },
  // );

  // app.put(
  //   "/:postId/comments/:commentId",
  //   { preValidation: [app.authenticate], schema: updateCommentSchema },
  //   async (req) => {
  //     const { body, params, user } = req;
  //     const { comment } = body;
  //     const { commentId, postId } = params;
  //     // todo: get user id from JWT
  //     //  check if user is authorized to edit comment (only your own comment, visibility can change?)
  //     const updatedComment = await Comment.findOneAndUpdate(
  //       { _id: commentId, authorId: user.id, postId },
  //       { comment },
  //       { new: true },
  //     );
  //     if (!updatedComment) {
  //       return new httpErrors.BadRequest();
  //     }
  //     return updatedComment;
  //   },
  // );

  // app.delete(
  //   "/:postId/comments/:commentId",
  //   { preValidation: [app.authenticate], schema: deleteCommentSchema },
  //   async (req) => {
  //     const { params, user } = req;
  //     const { commentId, postId } = params;
  //     // todo: get user id from JWT
  //     //  check if user is authorized to delete their own comment (visibility can change?)
  //     //  + also delete all sub comments?
  //     const { ok, deletedCount } = await Comment.deleteMany({
  //       $or: [
  //         { _id: commentId, authorId: user.id, postId },
  //         { parentId: commentId, postId },
  //       ],
  //     });
  //     if (ok !== 1 || deletedCount < 1) {
  //       return new httpErrors.BadRequest();
  //     }
  //     return { deletedCount, success: true };
  //   },
  // );

  // app.put(
  //   "/:postId/likes/:userId",
  //   { preValidation: [app.authenticate], schema: likeUnlikePostSchema },
  //   async (req) => {
  //     const { postId, userId } = req.params;
  //     // todo: get user id from JWT
  //     //  check if userId is the same as param, and if authorized to like (based on visibility)
  //     const updatedPost = await Post.findOneAndUpdate(
  //       { _id: postId, likes: { $ne: userId } },
  //       { $inc: { likesCount: 1 }, $push: { likes: userId } },
  //       { new: true },
  //     );
  //     if (!updatedPost) {
  //       return new httpErrors.BadRequest();
  //     }

  //     return {
  //       likes: updatedPost.likes,
  //       likesCount: updatedPost.likesCount,
  //     };
  //   },
  // );

  // app.delete(
  //   "/:postId/likes/:userId",
  //   { preValidation: [app.authenticate], schema: likeUnlikePostSchema },
  //   async (req) => {
  //     const { postId, userId } = req.params;
  //     // todo: get user id from JWT
  //     //  check if userId is the same as param, and if authorized to like (based on visibility)
  //     const updatedPost = await Post.findOneAndUpdate(
  //       { _id: postId, likes: userId },
  //       { $inc: { likesCount: -1 }, $pull: { likes: userId } },
  //       { new: true },
  //     );
  //     if (!updatedPost) {
  //       return new httpErrors.BadRequest();
  //     }

  //     return {
  //       likes: updatedPost.likes,
  //       likesCount: updatedPost.likesCount,
  //     };
  //   },
  // );

  // app.put(
  //   "/:postId/comments/:commentId/likes/:userId",
  //   { preValidation: [app.authenticate], schema: likeUnlikeCommentSchema },
  //   async (req) => {
  //     const { commentId, postId, userId } = req.params;
  //     // todo: get user id from JWT
  //     //  check if userId is the same as param, and if authorized to like (based on visibility)
  //     const updatedComment = await Comment.findOneAndUpdate(
  //       { _id: commentId, likes: { $ne: userId }, postId },
  //       { $inc: { likesCount: 1 }, $push: { likes: userId } },
  //       { new: true },
  //     );
  //     if (!updatedComment) {
  //       return new httpErrors.BadRequest();
  //     }

  //     return {
  //       likes: updatedComment.likes,
  //       likesCount: updatedComment.likesCount,
  //     };
  //   },
  // );

  // app.delete(
  //   "/:postId/comments/:commentId/likes/:userId",
  //   { preValidation: [app.authenticate], schema: likeUnlikeCommentSchema },
  //   async (req) => {
  //     const { commentId, postId, userId } = req.params;
  //     // todo: get user id from JWT
  //     //  check if userId is the same as param, and if authorized to like (based on visibility)
  //     const updatedComment = await Comment.findOneAndUpdate(
  //       { _id: commentId, likes: userId, postId },
  //       { $inc: { likesCount: -1 }, $pull: { likes: userId } },
  //       { new: true },
  //     );
  //     if (!updatedComment) {
  //       return new httpErrors.BadRequest();
  //     }

  //     return {
  //       likes: updatedComment.likes,
  //       likesCount: updatedComment.likesCount,
  //     };
  //   },
  // );
}

module.exports = routes;
