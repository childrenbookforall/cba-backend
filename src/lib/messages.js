function canonicalPair(idA, idB) {
  return idA < idB ? { userAId: idA, userBId: idB } : { userAId: idB, userBId: idA };
}

module.exports = { canonicalPair };
